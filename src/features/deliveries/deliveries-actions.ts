"use server";

import { sendDpdCongratsFor } from "@/features/notifications/dpd-shift-notices";
import { fetchLocationEventByDeliveryId, fetchLocationEventsForDelivery } from "@/features/locations/locations-actions";
import type { DriverLocationEvent } from "@/features/locations/types";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { deleteObject } from "@/lib/storage/r2-client";
import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-resolve";
import { applyDeliveryRollup } from "@/lib/search/delivery-rollup";
import { stampedPatch } from "@/lib/search/prefix";
import type { DocumentData, Firestore, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { earningsRecalcDateFromDeliveredAt } from "./delivery-earn-date";
import { trailPathFromEvents } from "./delivery-gps-audit";
import { listTotalFromStatusCounts, parseDeliveriesStatusCounts } from "./delivery-kpi-counts";
import { mergeProofKeys } from "./delivery-proof-keys";
import { IN_PROGRESS_DELIVERY_STATUSES, normalizeDeliveryStatusFilter } from "./delivery-status-filter";
import { collectExportPages } from "./export-pagination";
import {
  DELIVERY_LIST_PREFIX_FIELDS,
  DELIVERY_SEARCH_BACKFILL_COMPLETE,
  DELIVERY_SEARCH_CAP,
  capPrefixMatchSet,
  gpsInChunks,
  pagePrefixMatches,
  prefixPageDecision,
  routeDeliveryList,
  type DeliveryListRoute,
  type DeliverySearchShape,
} from "./delivery-list-plan";
import { mapDeliveryDbRowsToListRows, type DeliveryDbRowForList } from "./map-delivery-list-row";
import { CANCEL_REASON_CODES } from "./parse-cancel-reason";
import { enrichDeliveryListRows } from "./resolve-delivery-restaurant";
import type { DeliveryActionError, DeliveryListRow, DeliveryStatus, ReviewableDeliveryStatus } from "./types";

type DeliveryMutationResult =
  | { ok: true }
  | { error: DeliveryActionError; errorDetail?: string };

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type Row = Record<string, unknown> & { id: string };

const DELIVERIES_PAGE_SIZE = 50;
const AUTO_TAG = "[auto:delivery-approval]";

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, asRow(snap.id, snap.data()));
    }
  }
  return map;
}

function formatPgErrorDetail(error: PgLikeError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

async function requireDeliveriesView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireDeliveriesManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) return null;
  return session;
}

async function resolveDeliveryRestaurantId(input: {
  driver_id: string;
  partner_id: string | null;
  restaurant_id: string | null;
}): Promise<string | null> {
  if (input.restaurant_id) return input.restaurant_id;
  const db = await openDb();
  const assigned = await db
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", input.driver_id)
    .get();
  const assignedIds = assigned.docs
    .map((doc) => str(doc.data().restaurant_id))
    .filter(Boolean);

  if (assignedIds.length === 1 && !input.partner_id) return assignedIds[0] ?? null;

  if (assignedIds.length > 0 && input.partner_id) {
    const restaurants = await rowsByIds(db, COLLECTIONS.restaurants, assignedIds);
    const matched = [...restaurants.values()].filter((row) => str(row.partner_id) === input.partner_id);
    if (matched.length === 1) return matched[0]?.id ?? null;
  }

  if (!input.partner_id) return null;
  const partnerRestaurants = await db
    .collection(COLLECTIONS.restaurants)
    .where("partner_id", "==", input.partner_id)
    .limit(2)
    .get();
  if (partnerRestaurants.size === 1) return partnerRestaurants.docs[0]?.id ?? null;
  return null;
}

function earnDateFromDeliveredAt(deliveredAt: string): string {
  const earnDate = earningsRecalcDateFromDeliveredAt(deliveredAt);
  if (!earnDate) throw new Error("delivered_at required for earnings recalc");
  return earnDate;
}

async function syncVerificationForDelivery(
  delivery: {
    id: string;
    driver_id: string;
    delivered_at: string;
    partner_id: string | null;
    restaurant_id: string | null;
  },
  actorId: string,
): Promise<void> {
  const mutation = await requireMutationAuth();
  if ("error" in mutation) return;
  if (!delivery.partner_id) return;
  const serviceDate = earnDateFromDeliveredAt(delivery.delivered_at);
  const restaurantId = await resolveDeliveryRestaurantId({
    driver_id: delivery.driver_id,
    partner_id: delivery.partner_id,
    restaurant_id: delivery.restaurant_id,
  });
  if (!restaurantId) return;

  const db = await openDb();
  const start = new Date(`${serviceDate}T00:00:00+03:00`);
  const end = new Date(`${serviceDate}T23:59:59.999+03:00`);
  let dayRows: Row[] = [];
  try {
    const snap = await db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", delivery.driver_id)
      .where("delivered_at", ">=", start)
      .where("delivered_at", "<=", end)
      .get();
    dayRows = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    console.error("[syncVerificationForDelivery] count failed", error);
    return;
  }

  const eligible = dayRows.filter(
    (row) =>
      row.status !== "rejected" &&
      (str(row.restaurant_id) === restaurantId ||
        (row.restaurant_id == null && str(row.partner_id) === delivery.partner_id)),
  );
  const reported = eligible.length;
  const key = `${delivery.driver_id}_${restaurantId}_${serviceDate}`;
  const existingSnap = await db.collection(COLLECTIONS.deliveryVerifications).doc(key).get();
  const existing = existingSnap.exists ? asRow(existingSnap.id, existingSnap.data()) : null;

  if (existing) {
    const isAuto = str(existing.notes).includes(AUTO_TAG);
    if (!isAuto) {
      await existingSnap.ref.set({ updated_at: new Date() }, { merge: true });
      return;
    }
    if (Number(existing.reported_count ?? 0) !== reported) {
      await existingSnap.ref.set({ reported_count: reported, updated_at: new Date() }, { merge: true });
    }
    return;
  }

  if (reported === 0) return;
  try {
    await db.collection(COLLECTIONS.deliveryVerifications).doc(key).create({
      id: key,
      driver_id: delivery.driver_id,
      restaurant_id: restaurantId,
      partner_id: delivery.partner_id,
      service_date: serviceDate,
      reported_count: reported,
      notes: AUTO_TAG,
      source: "manual",
      created_by: actorId,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code !== 6 && code !== "already-exists" && code !== "23505") {
      console.error("[syncVerificationForDelivery] insert failed", error);
    }
  }
}

async function recalcEarningsForDelivery(driverId: string, deliveredAt: string) {
  const earnDate = earningsRecalcDateFromDeliveredAt(deliveredAt);
  if (!earnDate) return;
  await callAdminFunction("recalculate_driver_earnings", {
    p_driver_id: driverId,
    p_earn_date: earnDate,
  });
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

function relName(rel: { name: string } | { name: string }[] | null | undefined): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.name ?? "—";
}

export type DeliveriesQueryFilter = {
  status?: string;
  zoneId?: string;
  partnerId?: string;
  cancelReason?: string;
  search?: string;
  searchShape?: DeliverySearchShape;
  dateFrom?: string;
  dateTo?: string;
  dateToExclusive?: boolean;
};

export type DeliveriesPage = {
  rows: DeliveryListRow[];
  nextOffset: number | null;
  total: number;
  unindexedFilters?: string[];
  searchTruncated?: boolean;
};

export type DeliveriesKpiCounts = {
  total: number;
  active: number;
  verified: number;
  pending: number;
  rejected: number;
  cancelled: number;
};

export type DeliveryFilterOptions = {
  zones: Array<{ id: string; name: string }>;
  partners: Array<{ id: string; name: string }>;
};

export type DeliveryExportRow = Pick<
  DeliveryListRow,
  | "short_id"
  | "driver_name"
  | "driver_code"
  | "driver_employee_id"
  | "restaurant_name"
  | "zone_name"
  | "status"
  | "external_order_id"
  | "pickup_at"
  | "delivered_at"
  | "cancelled_at"
  | "cancel_reason"
>;

async function resolveSearchDriverIds(search: string): Promise<string[]> {
  const cleaned = search.replace(/[%,()]/g, " ").trim().toLowerCase();
  if (!cleaned) return [];
  const db = await openDb();
  const [drivers, profiles] = await Promise.all([
    db.collection(COLLECTIONS.drivers).select("driver_code").get(),
    db.collection(COLLECTIONS.profiles).select("full_name").get(),
  ]);
  const ids = new Set<string>();
  for (const doc of drivers.docs) {
    if (str(doc.data().driver_code).toLowerCase().includes(cleaned)) ids.add(doc.id);
  }
  for (const doc of profiles.docs) {
    if (str(doc.data().full_name).toLowerCase().includes(cleaned)) ids.add(doc.id);
  }
  return [...ids].slice(0, 300);
}

function matchesSearch(row: Row, search: string, driverIds: string[]): boolean {
  const cleaned = search.replace(/[,()*"\\%]/g, " ").trim().toLowerCase();
  const parts: boolean[] = [];
  if (cleaned) parts.push(str(row.external_order_id).toLowerCase().includes(cleaned));
  if (driverIds.length > 0) parts.push(driverIds.includes(str(row.driver_id)));
  const hex = search.trim().toLowerCase();
  if (/^[0-9a-f]{1,8}$/.test(hex)) parts.push(row.id.toLowerCase().startsWith(hex));
  if (parts.length === 0) return false;
  return parts.some(Boolean);
}

function matchesCancel(row: Row, code: string): boolean {
  const reason = row.cancel_reason == null ? null : str(row.cancel_reason);
  const concrete = CANCEL_REASON_CODES.filter((item) => item !== "other");
  if (code === "other") {
    if (reason == null || reason === "") return false;
    return !concrete.some((item) => reason.startsWith(item));
  }
  return (reason ?? "").startsWith(code);
}

function needsMemoryFilter(params: DeliveriesQueryFilter): boolean {
  return Boolean(params.search?.trim() || (params.cancelReason && params.cancelReason !== "all"));
}

function indexedQuery(db: Firestore, params: DeliveriesQueryFilter): Query {
  let query: Query = db.collection(COLLECTIONS.deliveries);
  const hasDateWindow = Boolean(params.dateFrom || params.dateTo);
  if (params.status && params.status !== "all") {
    if (params.status === "in_progress") {
      query = query.where("status", "in", [...IN_PROGRESS_DELIVERY_STATUSES]);
    } else {
      query = query.where("status", "==", normalizeDeliveryStatusFilter(params.status));
    }
  }
  if (params.zoneId && params.zoneId !== "all") query = query.where("zone_id", "==", params.zoneId);
  if (params.partnerId && params.partnerId !== "all") {
    query = query.where("partner_id", "==", params.partnerId);
  }
  if (params.dateFrom) query = query.where("delivered_at", ">=", new Date(params.dateFrom));
  if (params.dateTo) {
    query = query.where(
      "delivered_at",
      params.dateToExclusive ? "<" : "<=",
      new Date(params.dateTo),
    );
  }
  return hasDateWindow
    ? query.orderBy("delivered_at", "desc")
    : query.orderBy("created_at", "desc");
}

function rowMatches(row: Row, params: DeliveriesQueryFilter, driverIds: string[]): boolean {
  if (params.search?.trim() && !matchesSearch(row, params.search, driverIds)) return false;
  if (params.cancelReason && params.cancelReason !== "all" && !matchesCancel(row, params.cancelReason)) {
    return false;
  }
  return true;
}

async function pageDeliveryRows(
  db: Firestore,
  params: DeliveriesQueryFilter,
  driverIds: string[],
  offset: number,
  limit: number,
): Promise<{ rows: Row[]; hitCap: boolean }> {
  const query = indexedQuery(db, params);
  if (!needsMemoryFilter(params)) {
    const snap = await query.offset(offset).limit(limit).get();
    return { rows: snap.docs.map((doc) => asRow(doc.id, doc.data())), hitCap: false };
  }
  const matches: Row[] = [];
  let skipped = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  let scanned = 0;
  let hitCap = false;
  while (matches.length < limit && scanned < DELIVERY_SEARCH_CAP) {
    let page = query.limit(400);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      const row = asRow(doc.id, doc.data());
      if (!rowMatches(row, params, driverIds)) continue;
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      matches.push(row);
      if (matches.length >= limit) break;
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
    if (scanned >= DELIVERY_SEARCH_CAP) {
      hitCap = true;
      break;
    }
  }
  if (scanned >= DELIVERY_SEARCH_CAP && matches.length < limit) hitCap = true;
  return { rows: matches, hitCap };
}

async function hydrateListRows(db: Firestore, rows: Row[]): Promise<DeliveryDbRowForList[]> {
  const driverIds = rows.map((row) => str(row.driver_id)).filter(Boolean);
  const [drivers, profiles, partners, restaurants, zones] = await Promise.all([
    rowsByIds(db, COLLECTIONS.drivers, driverIds),
    rowsByIds(db, COLLECTIONS.profiles, driverIds),
    rowsByIds(db, COLLECTIONS.partners, rows.map((row) => str(row.partner_id)).filter(Boolean)),
    rowsByIds(db, COLLECTIONS.restaurants, rows.map((row) => str(row.restaurant_id)).filter(Boolean)),
    rowsByIds(db, COLLECTIONS.zones, rows.map((row) => str(row.zone_id)).filter(Boolean)),
  ]);
  return rows.map((row) => {
    const driver = drivers.get(str(row.driver_id));
    const profile = profiles.get(str(row.driver_id));
    const partner = partners.get(str(row.partner_id));
    const restaurant = restaurants.get(str(row.restaurant_id));
    const zone = zones.get(str(row.zone_id));
    return {
      id: row.id,
      driver_id: str(row.driver_id),
      partner_id: strOrNull(row.partner_id),
      restaurant_id: strOrNull(row.restaurant_id),
      zone_id: strOrNull(row.zone_id),
      external_order_id: strOrNull(row.external_order_id),
      order_proof_url: strOrNull(row.order_proof_url),
      order_proof_urls: Array.isArray(row.order_proof_urls) ? (row.order_proof_urls as string[]) : null,
      status: row.status as DeliveryStatus,
      rejection_reason: strOrNull(row.rejection_reason),
      delivered_at: strOrNull(row.delivered_at),
      delivered_lat: numOrNull(row.delivered_lat),
      delivered_lng: numOrNull(row.delivered_lng),
      pickup_at: strOrNull(row.pickup_at),
      pickup_lat: numOrNull(row.pickup_lat),
      pickup_lng: numOrNull(row.pickup_lng),
      pickup_proof_url: strOrNull(row.pickup_proof_url),
      pickup_proof_urls: Array.isArray(row.pickup_proof_urls) ? (row.pickup_proof_urls as string[]) : null,
      cancelled_at: strOrNull(row.cancelled_at),
      cancel_lat: numOrNull(row.cancel_lat),
      cancel_lng: numOrNull(row.cancel_lng),
      cancel_reason: strOrNull(row.cancel_reason),
      cancel_proof_url: strOrNull(row.cancel_proof_url),
      cancel_proof_urls: Array.isArray(row.cancel_proof_urls) ? (row.cancel_proof_urls as string[]) : null,
      created_at: str(row.created_at),
      drivers: driver
        ? {
            driver_code: str(driver.driver_code),
            employee_id: strOrNull(driver.employee_id),
            profiles: profile
              ? { full_name: strOrNull(profile.full_name), phone: strOrNull(profile.phone) }
              : null,
          }
        : null,
      partners: partner ? { name: str(partner.name), logo_url: strOrNull(partner.logo_url) } : null,
      restaurants: restaurant ? { id: restaurant.id, name: str(restaurant.name) } : null,
      zones: zone ? { name: str(zone.name) } : null,
    };
  });
}

async function fetchGpsMockFlagsByDeliveryIds(deliveryIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (deliveryIds.length === 0) return result;
  const work = (async () => {
    const db = await staffDb();
    if (!db) return;
    for (let i = 0; i < deliveryIds.length; i += 30) {
      const chunk = deliveryIds.slice(i, i + 30);
      const snap = await db
        .collection(COLLECTIONS.driverLocationEvents)
        .where("delivery_id", "in", chunk)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.is_mocked === true && typeof data.delivery_id === "string") {
          result.set(data.delivery_id, true);
        }
      }
    }
  })().catch((error: unknown) => {
    console.error("[fetchDeliveriesPage] gps mock lookup failed", error);
  });
  await Promise.race([
    work,
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
  for (const id of deliveryIds) {
    if (!result.has(id)) result.set(id, false);
  }
  return result;
}

type RecentDeliveryDbRow = {
  id: string;
  driver_id: string;
  status: DeliveryStatus;
  delivered_at: string | null;
  created_at?: string;
  external_order_id?: string | null;
  partners: { name: string } | { name: string }[] | null;
};

export type RecentDeliveryForDriver = {
  id: string;
  driver_id: string;
  short_id: string;
  status: DeliveryStatus;
  partner_name: string;
  delivered_at: string | null;
  created_at: string;
  external_order_id: string | null;
};

export async function resolveDeliveryProofForDisplay(
  objectKey: string | null | undefined,
): Promise<{ url: string | null; contentType: string | null }> {
  await requireDeliveriesView();
  const key = objectKey?.trim();
  if (!key) return { url: null, contentType: null };
  const resolved = await resolveOrderProofUrl(key);
  return { url: resolved?.url ?? null, contentType: resolved?.contentType ?? null };
}

export type ResolvedDeliveryProof = {
  url: string | null;
  contentType: string | null;
};

export async function fetchDeliveryDetailExtras(params: {
  deliveryId: string;
  proofKeys: string[];
}): Promise<{ proofs: Record<string, ResolvedDeliveryProof> }> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveryDetailExtras", { deliveryId: params.deliveryId });
  const uniqueKeys = [...new Set(params.proofKeys.map((key) => key.trim()).filter(Boolean))];
  const proofEntries = await Promise.all(
    uniqueKeys.map(async (key) => {
      const resolved = await resolveOrderProofUrl(key);
      return { key, url: resolved?.url ?? null, contentType: resolved?.contentType ?? null };
    }),
  );
  const proofs: Record<string, ResolvedDeliveryProof> = {};
  for (const entry of proofEntries) proofs[entry.key] = { url: entry.url, contentType: entry.contentType };
  return { proofs };
}

export async function fetchDeliveryGpsAudit(deliveryId: string): Promise<{
  gpsEvent: DriverLocationEvent | null;
  trail: Array<{ lat: number; lng: number }>;
}> {
  await requireDeliveriesView();
  let gpsEvent: DriverLocationEvent | null = null;
  let trail: Array<{ lat: number; lng: number }> = [];
  try {
    const [event, events] = await Promise.all([
      fetchLocationEventByDeliveryId(deliveryId),
      fetchLocationEventsForDelivery(deliveryId),
    ]);
    gpsEvent = event;
    trail = trailPathFromEvents(events);
  } catch (err) {
    console.error("[fetchDeliveryGpsAudit] gps event lookup failed", err);
  }
  return { gpsEvent, trail };
}

export type DashboardDeliveryRow = {
  id: string;
  short_id: string;
  driver_id: string;
  driver_name: string;
  status: DeliveryStatus;
  external_order_id: string | null;
  created_at: string;
  pickup_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
};

export async function fetchDashboardDeliveryRows(activityFrom: string): Promise<DashboardDeliveryRow[]> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDashboardDeliveryRows", { activityFrom });
  const db = await openDb();
  const from = new Date(activityFrom);
  const fields = ["cancelled_at", "delivered_at", "pickup_at", "created_at"] as const;
  const snaps = await Promise.all(
    fields.map((field) => db.collection(COLLECTIONS.deliveries).where(field, ">=", from).get()),
  );
  const byId = new Map<string, Row>();
  for (const snap of snaps) {
    for (const doc of snap.docs) byId.set(doc.id, asRow(doc.id, doc.data()));
  }
  const rows = [...byId.values()];
  const profiles = await rowsByIds(
    db,
    COLLECTIONS.profiles,
    rows.map((row) => str(row.driver_id)).filter(Boolean),
  );
  return rows.map((row) => ({
    id: row.id,
    short_id: row.id.slice(0, 8).toUpperCase(),
    driver_id: str(row.driver_id),
    driver_name: str(profiles.get(str(row.driver_id))?.full_name) || "—",
    status: row.status as DeliveryStatus,
    external_order_id: strOrNull(row.external_order_id),
    created_at: str(row.created_at),
    pickup_at: strOrNull(row.pickup_at),
    delivered_at: strOrNull(row.delivered_at),
    cancelled_at: strOrNull(row.cancelled_at),
  }));
}

function inclusiveUpperBound(to: string, exclusive?: boolean): string {
  if (!exclusive) return to;
  const ms = Date.parse(to);
  if (!Number.isFinite(ms)) return to;
  return new Date(ms - 1).toISOString();
}

const LOWERCASE_PROBE_MS = 60_000;
let lowercaseProbe: { at: number; indexed: boolean } | null = null;

function createdAtMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const ms = (value as { toDate: () => Date }).toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

async function deliveriesLowercaseIndexed(db: Firestore): Promise<boolean> {
  if (!DELIVERY_SEARCH_BACKFILL_COMPLETE) return false;
  const now = Date.now();
  if (lowercaseProbe && now - lowercaseProbe.at < LOWERCASE_PROBE_MS) return lowercaseProbe.indexed;
  let indexed = false;
  try {
    const snap = await db.collection(COLLECTIONS.deliveries).orderBy("order_id_lower").limit(1).get();
    indexed = !snap.empty;
  } catch {
    indexed = false;
  }
  lowercaseProbe = { at: now, indexed };
  return indexed;
}

function deliveryRoute(
  params: DeliveriesQueryFilter,
  indexed: boolean,
  offset: number,
  limit: number,
): DeliveryListRoute {
  return routeDeliveryList({
    search: params.search,
    searchShape: params.searchShape,
    cancelReason: params.cancelReason,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    status: params.status,
    zoneId: params.zoneId,
    partnerId: params.partnerId,
    indexed,
    offset,
    limit,
  });
}

function withPrefixEquality(
  query: Query,
  params: DeliveriesQueryFilter,
  fieldEquality: "status" | "zone_id" | "partner_id" | null,
): Query {
  switch (fieldEquality) {
    case null:
      return query;
    case "status":
      if (!params.status || params.status === "all") return query;
      if (params.status === "in_progress") {
        return query.where("status", "in", [...IN_PROGRESS_DELIVERY_STATUSES]);
      }
      return query.where("status", "==", normalizeDeliveryStatusFilter(params.status));
    case "zone_id":
      if (!params.zoneId || params.zoneId === "all") return query;
      return query.where("zone_id", "==", params.zoneId);
    case "partner_id":
      if (!params.partnerId || params.partnerId === "all") return query;
      return query.where("partner_id", "==", params.partnerId);
    default: {
      const unexpected: never = fieldEquality;
      return unexpected;
    }
  }
}

/**
 * Prefix-field order, capped at the search cap. Newest-first is applied by
 * pagePrefixMatches. A Firestore cursor is not created_at order.
 * Returns null when a query throws (index not deployed) so the caller can scan.
 */
async function pageByPrefix(
  db: Firestore,
  params: DeliveriesQueryFilter,
  route: Extract<DeliveryListRoute, { kind: "prefix" }>,
  offset: number,
  limit: number,
): Promise<{ rows: Row[]; total: number; capped: boolean } | null> {
  try {
    const matches = new Map<string, number>();
    let capped = false;
    await Promise.all(
      DELIVERY_LIST_PREFIX_FIELDS.map(async (field) => {
        const snap = await withPrefixEquality(db.collection(COLLECTIONS.deliveries), params, route.fieldEquality)
          .where(field, ">=", route.bounds.start)
          .where(field, "<=", route.bounds.end)
          .orderBy(field, "asc")
          .select(field, "created_at")
          .limit(DELIVERY_SEARCH_CAP)
          .get();
        if (snap.size >= DELIVERY_SEARCH_CAP) capped = true;
        for (const doc of snap.docs) {
          const ms = createdAtMs(doc.get("created_at"));
          const prev = matches.get(doc.id);
          if (prev === undefined || ms > prev) matches.set(doc.id, ms);
        }
      }),
    );
    const cappedSet = capPrefixMatchSet(
      [...matches].map(([id, createdAtMs]) => ({ id, createdAtMs })),
      DELIVERY_SEARCH_CAP,
      capped,
    );
    const page = pagePrefixMatches(cappedSet.rows, offset, limit);
    const byId = await rowsByIds(
      db,
      COLLECTIONS.deliveries,
      page.map((row) => row.id),
    );
    const rows: Row[] = [];
    for (const match of page) {
      const row = byId.get(match.id);
      if (row) rows.push(row);
    }
    return { rows, total: cappedSet.rows.length, capped: cappedSet.truncated };
  } catch {
    return null;
  }
}

async function indexedStatusTotal(params: DeliveriesQueryFilter): Promise<number | null> {
  const hasDateWindow = Boolean(params.dateFrom || params.dateTo);
  const { data: rawCounts, error: countError } = await callAdminFunction("admin_deliveries_status_counts", {
    p_from: params.dateFrom ?? undefined,
    p_to: params.dateTo ? inclusiveUpperBound(params.dateTo, params.dateToExclusive) : undefined,
    p_zone_id: params.zoneId && params.zoneId !== "all" ? params.zoneId : undefined,
    p_partner_id: params.partnerId && params.partnerId !== "all" ? params.partnerId : undefined,
    p_date_basis: hasDateWindow ? "delivered" : undefined,
  });
  if (countError) return null;
  return listTotalFromStatusCounts(parseDeliveriesStatusCounts(rawCounts), params.status);
}

type LoadedSlice = {
  rows: Row[];
  total: number | null;
  reasons: string[];
  /** Set once a contains/scan path has resolved rider ids. Null means that path did not run. */
  resolvedDriverIds: string[] | null;
  searchTruncated: boolean;
};

async function loadDeliverySlice(
  db: Firestore,
  params: DeliveriesQueryFilter,
  offset: number,
  limit: number,
  knownDriverIds: string[] | null,
): Promise<LoadedSlice> {
  const indexed = await deliveriesLowercaseIndexed(db);
  const route = deliveryRoute(params, indexed, offset, limit);
  const reasons = [...route.reasons];
  switch (route.kind) {
    case "indexed": {
      const [page, total] = await Promise.all([
        pageDeliveryRows(db, params, [], offset, limit),
        indexedStatusTotal(params),
      ]);
      return { rows: page.rows, total, reasons, resolvedDriverIds: null, searchTruncated: false };
    }
    case "prefix_too_short":
      return {
        rows: [],
        total: 0,
        reasons,
        resolvedDriverIds: null,
        searchTruncated: false,
      };
    case "prefix": {
      const prefix = await pageByPrefix(db, params, route, offset, limit);
      const decision = prefixPageDecision({
        backfillComplete: DELIVERY_SEARCH_BACKFILL_COMPLETE,
        probeFoundField: indexed,
        prefixRowCount: prefix ? prefix.rows.length : null,
        capped: prefix?.capped ?? false,
      });
      if (decision === "prefix" && prefix) {
        if (prefix.capped) reasons.push("prefix_cap");
        return {
          rows: prefix.rows,
          total: prefix.total,
          reasons,
          resolvedDriverIds: null,
          searchTruncated: prefix.capped,
        };
      }
      reasons.push(prefix ? "prefix_unstamped" : "index_not_ready");
      break;
    }
    case "scan":
      break;
    default: {
      const unexpected: never = route;
      return unexpected;
    }
  }
  const search = params.search?.trim() ?? "";
  const driverIds = knownDriverIds ?? (search ? await resolveSearchDriverIds(search) : []);
  const page = await pageDeliveryRows(db, params, driverIds, offset, limit);
  if (page.hitCap) reasons.push("contains_scan_cap");
  return {
    rows: page.rows,
    total: null,
    reasons,
    resolvedDriverIds: driverIds,
    searchTruncated: page.hitCap,
  };
}

export async function fetchDeliveriesPage(
  params: DeliveriesQueryFilter & { offset?: number },
): Promise<DeliveriesPage> {
  await requireDeliveriesView();
  const db = await openDb();
  const offset = Math.max(0, params.offset ?? 0);
  const limit = DELIVERIES_PAGE_SIZE;
  const loaded = await loadDeliverySlice(db, params, offset, limit, null);
  void logAdminRead("deliveries", "fetchDeliveriesPage", { unindexedFilters: loaded.reasons });

  let total = loaded.total ?? offset + loaded.rows.length;
  if (loaded.total == null && loaded.rows.length === limit && !loaded.searchTruncated) {
    const extra = await pageDeliveryRows(db, params, loaded.resolvedDriverIds ?? [], offset + limit, 1);
    if (extra.hitCap) loaded.searchTruncated = true;
    if (extra.rows.length > 0) total = offset + limit + 1;
  }

  const hydrated = await hydrateListRows(db, loaded.rows);
  const gpsFlags = await fetchGpsMockFlagsByDeliveryIds(hydrated.map((row) => row.id));
  const mapped = await mapDeliveryDbRowsToListRows(hydrated, gpsFlags, { resolveAssets: false });
  const enriched = await enrichDeliveryListRows(mapped);
  return {
    rows: enriched,
    nextOffset: loaded.rows.length === limit ? offset + limit : null,
    total,
    unindexedFilters: loaded.reasons,
    searchTruncated: loaded.searchTruncated,
  };
}

export type DeliveryCountsByFilters = {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  cancelled: number;
  in_transit: number;
  under_review: number;
  filters: {
    dateFrom?: string;
    dateTo?: string;
    zoneId?: string;
    partnerId?: string;
    driverId?: string;
    restaurantId?: string;
  };
};

export async function countDeliveriesByFilters(params: {
  dateFrom?: string;
  dateTo?: string;
  dateToExclusive?: boolean;
  zoneId?: string;
  partnerId?: string;
  driverId?: string;
  restaurantId?: string;
}): Promise<DeliveryCountsByFilters> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "countDeliveriesByFilters", {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    zoneId: params.zoneId,
    partnerId: params.partnerId,
    driverId: params.driverId,
    restaurantId: params.restaurantId,
  });
  const hasDateWindow = Boolean(params.dateFrom || params.dateTo);
  const { data, error } = await callAdminFunction("admin_deliveries_counts_by_filters", {
    p_from: params.dateFrom ?? undefined,
    p_to: params.dateTo ? inclusiveUpperBound(params.dateTo, params.dateToExclusive) : undefined,
    p_zone_id: params.zoneId && params.zoneId !== "all" ? params.zoneId : undefined,
    p_partner_id: params.partnerId && params.partnerId !== "all" ? params.partnerId : undefined,
    p_driver_id: params.driverId ?? undefined,
    p_restaurant_id: params.restaurantId ?? undefined,
    p_date_basis: hasDateWindow ? "delivered" : undefined,
  });
  if (error) throw new Error(error.message);
  const counts = (data ?? {}) as Record<string, unknown>;
  const read = (key: string): number => {
    const value = Number(counts[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    total: read("total"),
    verified: read("verified"),
    pending: read("pending"),
    rejected: read("rejected"),
    cancelled: read("cancelled"),
    in_transit: read("in_transit"),
    under_review: read("under_review"),
    filters: {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      zoneId: params.zoneId,
      partnerId: params.partnerId,
      driverId: params.driverId,
      restaurantId: params.restaurantId,
    },
  };
}

export async function fetchDeliveriesKpis(): Promise<DeliveriesKpiCounts> {
  await requireDeliveriesView();
  const { data, error } = await callAdminFunction("admin_deliveries_status_counts");
  if (error) throw new Error(error.message);
  const counts = parseDeliveriesStatusCounts(data);
  return {
    total: counts.total,
    active: counts.active,
    verified: counts.verified,
    pending: counts.pending,
    rejected: counts.rejected,
    cancelled: counts.cancelled,
  };
}

export async function fetchDeliveryFilterOptions(): Promise<DeliveryFilterOptions> {
  await requireDeliveriesView();
  const db = await openDb();
  const [zones, partners] = await Promise.all([
    db.collection(COLLECTIONS.zones).get(),
    db.collection(COLLECTIONS.partners).get(),
  ]);
  return {
    zones: zones.docs
      .map((doc) => ({ id: doc.id, name: str(doc.data().name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    partners: partners.docs
      .map((doc) => ({ id: doc.id, name: str(doc.data().name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchDeliveriesForExport(params: DeliveriesQueryFilter): Promise<DeliveryExportRow[]> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveriesForExport");
  const db = await openDb();
  const search = params.search?.trim() ?? "";
  const searchDriverIds = search ? await resolveSearchDriverIds(search) : [];
  const collected = await collectExportPages<Row>(async (offset, limit) => {
    const page = await pageDeliveryRows(db, params, searchDriverIds, offset, limit);
    return page.rows;
  });
  const driverIds = collected.map((row) => str(row.driver_id)).filter(Boolean);
  const [drivers, profiles, restaurants, zones] = await Promise.all([
    rowsByIds(db, COLLECTIONS.drivers, driverIds),
    rowsByIds(db, COLLECTIONS.profiles, driverIds),
    rowsByIds(db, COLLECTIONS.restaurants, collected.map((row) => str(row.restaurant_id)).filter(Boolean)),
    rowsByIds(db, COLLECTIONS.zones, collected.map((row) => str(row.zone_id)).filter(Boolean)),
  ]);
  return collected.map((row) => {
    const driver = drivers.get(str(row.driver_id));
    const profile = profiles.get(str(row.driver_id));
    const restaurant = restaurants.get(str(row.restaurant_id));
    const zone = zones.get(str(row.zone_id));
    const restaurantName = restaurant ? str(restaurant.name) : "—";
    return {
      short_id: shortId(row.id),
      driver_name: str(profile?.full_name) || "—",
      driver_code: str(driver?.driver_code) || "—",
      driver_employee_id: str(driver?.employee_id) || "—",
      restaurant_name: restaurantName === "—" ? null : restaurantName,
      zone_name: zone ? str(zone.name) : "—",
      status: row.status as DeliveryStatus,
      external_order_id: strOrNull(row.external_order_id),
      pickup_at: strOrNull(row.pickup_at),
      delivered_at: strOrNull(row.delivered_at),
      cancelled_at: strOrNull(row.cancelled_at),
      cancel_reason: strOrNull(row.cancel_reason),
    };
  });
}

export async function fetchRecentDeliveriesForDriver(
  driverId: string,
  limit = 2,
): Promise<RecentDeliveryForDriver[]> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchRecentDeliveriesForDriver");
  if (!driverId) return [];
  const db = await openDb();
  const safeLimit = Math.max(1, Math.min(limit, 10));
  const snap = await db
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .orderBy("created_at", "desc")
    .limit(safeLimit)
    .get();
  const rows = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  const partners = await rowsByIds(
    db,
    COLLECTIONS.partners,
    rows.map((row) => str(row.partner_id)).filter(Boolean),
  );
  return rows.map((row) => {
    const partner = partners.get(str(row.partner_id));
    const shaped: RecentDeliveryDbRow = {
      id: row.id,
      driver_id: str(row.driver_id),
      status: row.status as DeliveryStatus,
      delivered_at: strOrNull(row.delivered_at),
      created_at: str(row.created_at),
      external_order_id: strOrNull(row.external_order_id),
      partners: partner ? { name: str(partner.name) } : null,
    };
    return {
      id: shaped.id,
      driver_id: shaped.driver_id,
      short_id: shortId(shaped.id),
      status: shaped.status,
      partner_name: relName(shaped.partners),
      delivered_at: shaped.delivered_at,
      created_at: shaped.created_at ?? "",
      external_order_id: shaped.external_order_id ?? null,
    };
  });
}

function deliveryRollupDay(row: Row): string | null {
  const shift = str(row.shift_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(shift)) return shift;
  return (
    earningsRecalcDateFromDeliveredAt(strOrNull(row.delivered_at)) ??
    earningsRecalcDateFromDeliveredAt(strOrNull(row.pickup_at))
  );
}

export async function updateDeliveryStatus(
  deliveryId: string,
  status: ReviewableDeliveryStatus,
  rejectionReason?: string,
): Promise<DeliveryMutationResult> {
  const mutation = await requireMutationAuth();
  if ("error" in mutation) return { error: "not_authorized" };
  const session = await requireDeliveriesManage();
  if (!session) return { error: "not_authorized" };
  if (status === "rejected") {
    const trimmed = rejectionReason?.trim() ?? "";
    if (!trimmed) return { error: "reason_required" };
  }

  const db = await openDb();
  const existingSnap = await db.collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  if (!existingSnap.exists) return { error: "update_failed" };
  const existing = asRow(existingSnap.id, existingSnap.data());
  if (existing.status === "in_transit" || existing.status === "cancelled") {
    return { error: "invalid_status" };
  }

  const updatePayload: Record<string, unknown> =
    status === "rejected"
      ? { status: "rejected", rejection_reason: rejectionReason!.trim() }
      : { status, rejection_reason: null };

  const resolvedRestaurantId =
    status === "verified"
      ? await resolveDeliveryRestaurantId({
          driver_id: str(existing.driver_id),
          partner_id: strOrNull(existing.partner_id),
          restaurant_id: strOrNull(existing.restaurant_id),
        })
      : null;
  if (resolvedRestaurantId && status !== "rejected") {
    updatePayload.restaurant_id = resolvedRestaurantId;
  }

  try {
    await existingSnap.ref.set(stampedPatch("deliveries", existing, updatePayload), { merge: true });
  } catch (error) {
    return {
      error: "update_failed",
      errorDetail: formatPgErrorDetail({ message: error instanceof Error ? error.message : "save_failed" }),
    };
  }

  void logAdminMutation({
    action: "update",
    entityType: "delivery",
    entityId: deliveryId,
    routeName: "updateDeliveryStatus",
    before: { status: existing.status },
    after: {
      status,
      rejection_reason: status === "rejected" ? rejectionReason?.trim() ?? null : null,
    },
    context: { driver_id: existing.driver_id, delivered_at: existing.delivered_at },
  });

  try {
    const day = deliveryRollupDay(existing);
    const driverId = str(existing.driver_id);
    if (day && driverId && existing.status !== status) {
      await applyDeliveryRollup(db, {
        deliveryId,
        driverId,
        zoneId: strOrNull(existing.zone_id),
        day,
        status,
      });
    }
    const affectsEarnings = existing.status === "verified" || status === "verified";
    if (affectsEarnings && str(existing.delivered_at)) {
      await recalcEarningsForDelivery(str(existing.driver_id), str(existing.delivered_at));
    }
    await syncVerificationForDelivery(
      {
        id: existing.id,
        driver_id: str(existing.driver_id),
        delivered_at: str(existing.delivered_at) || new Date().toISOString(),
        partner_id: strOrNull(existing.partner_id),
        restaurant_id: resolvedRestaurantId ?? strOrNull(existing.restaurant_id),
      },
      session.id,
    );
    if (status === "verified") await sendDpdCongratsFor([str(existing.driver_id)]);
  } catch (sideEffectError) {
    console.error("[updateDeliveryStatus] post-update side effect failed", sideEffectError);
  }

  return { ok: true };
}

export async function verifyDelivery(deliveryId: string): Promise<DeliveryMutationResult> {
  return updateDeliveryStatus(deliveryId, "verified");
}

export async function rejectDelivery(
  deliveryId: string,
  reason: string,
): Promise<DeliveryMutationResult> {
  return updateDeliveryStatus(deliveryId, "rejected", reason);
}

const BULK_UPDATE_MAX = 100;

export type BulkUpdateDeliveriesResult =
  | { ok: true; updated: number; skipped: number; failed: number }
  | { error: DeliveryActionError; errorDetail?: string };

function bulkUpdateErrorFromMessage(message: string | undefined): DeliveryActionError {
  const text = message ?? "";
  if (text.includes("not_authorized")) return "not_authorized";
  if (text.includes("invalid_status")) return "invalid_status";
  if (text.includes("reason_required")) return "reason_required";
  if (text.includes("too_many")) return "too_many";
  return "update_failed";
}

export async function bulkUpdateDeliveries(
  deliveryIds: string[],
  status: Extract<ReviewableDeliveryStatus, "verified" | "rejected">,
  rejectionReason?: string,
): Promise<BulkUpdateDeliveriesResult> {
  const mutation = await requireMutationAuth();
  if ("error" in mutation) return { error: "not_authorized" };
  const session = await requireDeliveriesManage();
  if (!session) return { error: "not_authorized" };
  const ids = [...new Set(deliveryIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, updated: 0, skipped: 0, failed: 0 };
  if (ids.length > BULK_UPDATE_MAX) return { error: "too_many" };
  if (status === "rejected" && !rejectionReason?.trim()) return { error: "reason_required" };

  const { data, error } = await callAdminFunction("admin_bulk_update_deliveries", {
    p_ids: ids,
    p_status: status,
    p_reason: rejectionReason?.trim() ?? "",
  });
  if (error) {
    return { error: bulkUpdateErrorFromMessage(error.message), errorDetail: formatPgErrorDetail(error) };
  }

  const payload = (data ?? {}) as { updated?: number; skipped?: number; failed?: number };
  const updated = Number(payload.updated ?? 0);
  const skipped = Number(payload.skipped ?? 0);
  const failed = Number(payload.failed ?? 0);

  void logAdminMutation({
    action: "update",
    entityType: "delivery",
    routeName: "bulkUpdateDeliveries",
    context: { status, requested: ids.length, updated, skipped, failed },
  });

  if (status === "verified" && updated > 0) {
    try {
      const db = await openDb();
      const rows = await rowsByIds(db, COLLECTIONS.deliveries, ids);
      const driverIds = [...rows.values()]
        .filter((row) => row.status === "verified")
        .map((row) => str(row.driver_id))
        .filter(Boolean);
      await sendDpdCongratsFor(driverIds);
    } catch (sideEffectError) {
      console.error("[bulkUpdateDeliveries] congrats push failed", sideEffectError);
    }
  }

  return { ok: true, updated, skipped, failed };
}

export async function deleteDelivery(deliveryId: string): Promise<DeliveryMutationResult> {
  const mutation = await requireMutationAuth();
  if ("error" in mutation) return { error: "not_authorized" };
  const session = await requireSuperAdmin();
  if (!session) return { error: "not_authorized" };
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  if (!snap.exists) return { error: "delete_failed" };
  const row = asRow(snap.id, snap.data());
  const proofKeys = [
    ...mergeProofKeys(strOrNull(row.order_proof_url), Array.isArray(row.order_proof_urls) ? row.order_proof_urls as string[] : null),
    ...mergeProofKeys(strOrNull(row.pickup_proof_url), Array.isArray(row.pickup_proof_urls) ? row.pickup_proof_urls as string[] : null),
    ...mergeProofKeys(strOrNull(row.cancel_proof_url), Array.isArray(row.cancel_proof_urls) ? row.cancel_proof_urls as string[] : null),
  ];

  for (const proofKey of proofKeys) {
    if (!isR2ObjectKey(proofKey)) continue;
    try {
      await deleteObject(proofKey);
    } catch {
      /* best-effort R2 cleanup */
    }
    try {
      const uploads = await db.collection("storage_uploads").where("object_key", "==", proofKey).get();
      await Promise.all(uploads.docs.map((doc) => doc.ref.delete()));
    } catch {
      /* best-effort audit cleanup */
    }
  }

  try {
    await snap.ref.delete();
  } catch (error) {
    return {
      error: "delete_failed",
      errorDetail: formatPgErrorDetail({ message: error instanceof Error ? error.message : "save_failed" }),
    };
  }

  void logAdminMutation({
    action: "delete",
    entityType: "delivery",
    entityId: deliveryId,
    routeName: "deleteDelivery",
    before: { status: row.status, driver_id: row.driver_id, delivered_at: row.delivered_at },
  });

  if (row.status === "verified" && str(row.delivered_at)) {
    try {
      await recalcEarningsForDelivery(str(row.driver_id), str(row.delivered_at));
    } catch (sideEffectError) {
      console.error("[deleteDelivery] earnings recalc failed", sideEffectError);
    }
  }
  return { ok: true };
}

export type LiveDriverLocationForDelivery = {
  latitude: number;
  longitude: number;
  lastSeenAt: string;
  isMocked: boolean | null;
  headingDeg: number | null;
};

export async function fetchLiveDriverLocationForDelivery(
  deliveryId: string,
  driverId: string,
): Promise<LiveDriverLocationForDelivery | null> {
  await requireDeliveriesView();
  if (!deliveryId || !driverId) return null;
  const db = await openDb();
  const direct = await db.collection(COLLECTIONS.driverLocations).doc(driverId).get();
  const snap = direct.exists
    ? direct
    : (await db.collection(COLLECTIONS.driverLocations).where("driver_id", "==", driverId).limit(1).get()).docs[0];
  if (!snap?.exists) return null;
  const row = asRow(snap.id, snap.data());
  if (str(row.active_delivery_id) && str(row.active_delivery_id) !== deliveryId) return null;
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    lastSeenAt: str(row.last_seen_at),
    isMocked: row.is_mocked == null ? null : row.is_mocked === true,
    headingDeg: row.heading_deg == null ? null : Number(row.heading_deg),
  };
}
