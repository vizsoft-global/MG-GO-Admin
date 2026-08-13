"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { fetchLocationEventByDeliveryId } from "@/features/locations/locations-actions";
import type { DriverLocationEvent } from "@/features/locations/types";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-url";
import { earningsRecalcDateFromDeliveredAt } from "./delivery-earn-date";
import { deleteObject } from "@/lib/storage/r2-client";
import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import type {
  DeliveryActionError,
  DeliveryListRow,
  DeliveryStatus,
  ReviewableDeliveryStatus,
} from "./types";
import { sortDeliveriesByActivity } from "./delivery-sort-utils";
import { enrichDeliveryListRows } from "./resolve-delivery-restaurant";
import {
  mapDeliveryDbRowsToListRows,
  type DeliveryDbRowForList,
} from "./map-delivery-list-row";
import { CANCEL_REASON_CODES } from "./parse-cancel-reason";

type DeliveryMutationResult =
  | { ok: true }
  | { error: DeliveryActionError; errorDetail?: string };

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

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

async function resolveDeliveryRestaurantId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    driver_id: string;
    partner_id: string | null;
    restaurant_id: string | null;
  },
): Promise<string | null> {
  if (input.restaurant_id) return input.restaurant_id;

  const { data: assigned } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", input.driver_id)
    .limit(5);

  const assignedIds = (assigned ?? [])
    .map((row) => row.restaurant_id)
    .filter((id): id is string => Boolean(id));

  if (assignedIds.length === 1 && !input.partner_id) {
    return assignedIds[0];
  }

  if (assignedIds.length > 0 && input.partner_id) {
    const { data: matchedAssigned } = await supabase
      .from("restaurants")
      .select("id")
      .in("id", assignedIds)
      .eq("partner_id", input.partner_id)
      .limit(2);
    if ((matchedAssigned ?? []).length === 1) {
      return matchedAssigned![0]!.id;
    }
  }

  if (!input.partner_id) return null;

  const { data: partnerRestaurants } = await supabase
    .from("restaurants")
    .select("id")
    .eq("partner_id", input.partner_id)
    .order("created_at", { ascending: true })
    .limit(2);
  if ((partnerRestaurants ?? []).length === 1) {
    return partnerRestaurants![0]!.id;
  }

  return null;
}

function earnDateFromDeliveredAt(deliveredAt: string): string {
  const earnDate = earningsRecalcDateFromDeliveredAt(deliveredAt);
  if (!earnDate) {
    throw new Error("delivered_at required for earnings recalc");
  }
  return earnDate;
}

/**
 * Keep DPD verification in sync after a delivery's status changes.
 *
 * When an admin approves (or moves out of) a delivery on the deliveries page
 * we want the DPD verification page to immediately reflect that admin's
 * decision instead of waiting for the restaurant to file a report. We:
 *
 *  1. Count the deliveries on the same Kuwait service-date for the same
 *     driver+restaurant (or driver+partner if the delivery has no restaurant
 *     attached) that are eligible to be matched (i.e. not rejected).
 *  2. Upsert a delivery_verifications row with `reported_count` set to that
 *     count so the trigger reconciles statuses on its own.
 *
 * Auto-created rows are tagged in `notes` so we never overwrite a
 * restaurant-reported figure once a human has entered one.
 */
async function syncVerificationForDelivery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  delivery: {
    id: string;
    driver_id: string;
    delivered_at: string;
    partner_id: string | null;
    restaurant_id: string | null;
  },
  actorId: string,
): Promise<void> {
  // We need at least a partner to scope the verification (verifications.partner_id
  // is NOT NULL). If the delivery has no partner, skip — there's nothing to
  // reconcile against.
  if (!delivery.partner_id) return;

  const serviceDate = earnDateFromDeliveredAt(delivery.delivered_at);

  // Resolve the restaurant we'll attach the verification to. If the delivery
  // has its own restaurant, use that; otherwise, fall back to a single
  // restaurant on the partner so we still have one to write to.
  const restaurantId = await resolveDeliveryRestaurantId(supabase, {
    driver_id: delivery.driver_id,
    partner_id: delivery.partner_id,
    restaurant_id: delivery.restaurant_id,
  });
  if (!restaurantId) return;

  // Count eligible deliveries for this driver+restaurant_or_partner+date.
  const startIso = `${serviceDate}T00:00:00+03:00`;
  const endIso = `${serviceDate}T23:59:59.999+03:00`;

  const { data: dayRows, error: countError } = await supabase
    .from("deliveries")
    .select("id, status, restaurant_id, partner_id")
    .eq("driver_id", delivery.driver_id)
    .gte("delivered_at", startIso)
    .lte("delivered_at", endIso);
  if (countError) {
    console.error("[syncVerificationForDelivery] count failed", countError);
    return;
  }

  const eligible = (dayRows ?? []).filter(
    (d) =>
      d.status !== "rejected" &&
      (d.restaurant_id === restaurantId ||
        (d.restaurant_id == null && d.partner_id === delivery.partner_id)),
  );
  const reported = eligible.length;

  // Look up an existing verification for the same key.
  const { data: existing } = await supabase
    .from("delivery_verifications")
    .select("id, source, reported_count, notes")
    .eq("driver_id", delivery.driver_id)
    .eq("restaurant_id", restaurantId)
    .eq("service_date", serviceDate)
    .maybeSingle();

  const AUTO_TAG = "[auto:delivery-approval]";

  if (existing) {
    const isAuto = (existing.notes ?? "").includes(AUTO_TAG);
    // Don't clobber a real restaurant report; just trigger a reconcile by
    // touching the row so the trigger re-runs.
    if (!isAuto) {
      await supabase
        .from("delivery_verifications")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return;
    }
    if (existing.reported_count !== reported) {
      await supabase
        .from("delivery_verifications")
        .update({
          reported_count: reported,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return;
  }

  // No verification exists yet — create one tagged so future syncs know it's
  // safe to update the count.
  if (reported === 0) return;

  const { error: insertError } = await supabase
    .from("delivery_verifications")
    .insert({
      driver_id: delivery.driver_id,
      restaurant_id: restaurantId,
      partner_id: delivery.partner_id,
      service_date: serviceDate,
      reported_count: reported,
      notes: AUTO_TAG,
      source: "manual",
      created_by: actorId,
    });
  if (insertError && insertError.code !== "23505") {
    console.error("[syncVerificationForDelivery] insert failed", insertError);
  }
}

async function recalcEarningsForDelivery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
  deliveredAt: string,
) {
  const earnDate = earningsRecalcDateFromDeliveredAt(deliveredAt);
  if (!earnDate) return;
  await supabase.rpc("recalculate_driver_earnings", {
    p_driver_id: driverId,
    p_earn_date: earnDate,
  });
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

function relName<T extends { name: string }>(
  rel: T | T[] | null | undefined,
): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.name ?? "—";
}

/**
 * Shared column projection for delivery list/table rows (joins driver, partner,
 * restaurant, and zone names). Used by the paginated list, export, and the
 * dashboard feed so the shape stays in sync.
 */
const DELIVERY_LIST_SELECT = `
  id,
  driver_id,
  partner_id,
  restaurant_id,
  zone_id,
  external_order_id,
  order_proof_url,
  status,
  rejection_reason,
  delivered_at,
  delivered_lat,
  delivered_lng,
  pickup_at,
  pickup_lat,
  pickup_lng,
  pickup_proof_url,
  cancelled_at,
  cancel_lat,
  cancel_lng,
  cancel_reason,
  cancel_proof_url,
  created_at,
  drivers (driver_code, employee_id, profiles (full_name, phone)),
  partners (name, logo_url),
  restaurants (id, name),
  zones (name)
`;

/** Page size for the deliveries infinite-scroll list. */
const DELIVERIES_PAGE_SIZE = 50;

export type DeliveriesQueryFilter = {
  /**
   * Tab/status filter: "all" | "in_progress" (in_transit + pending +
   * under_review) | "active" (in_transit) | a concrete status.
   */
  status?: string;
  zoneId?: string;
  partnerId?: string;
  /** Cancel-reason code (only meaningful for the cancelled tab) or "all". */
  cancelReason?: string;
  search?: string;
  /** Inclusive ISO bound on created_at (start of range). */
  dateFrom?: string;
  /** Inclusive ISO bound on created_at (end of range). */
  dateTo?: string;
};

import {
  IN_PROGRESS_DELIVERY_STATUSES,
  normalizeDeliveryStatusFilter,
} from "./delivery-status-filter";

export type DeliveriesPage = {
  rows: DeliveryListRow[];
  nextOffset: number | null;
  total: number;
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

/** Resolve driver_ids whose code or rider name matches the search term. */
async function resolveSearchDriverIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  search: string,
): Promise<string[]> {
  const cleaned = search.replace(/[%,()]/g, " ").trim();
  if (!cleaned) return [];
  const like = `%${cleaned}%`;
  const [{ data: byCode }, { data: byName }] = await Promise.all([
    supabase.from("drivers").select("id").ilike("driver_code", like).limit(300),
    supabase.from("profiles").select("id").ilike("full_name", like).limit(300),
  ]);
  const ids = new Set<string>();
  for (const r of byCode ?? []) ids.add((r as { id: string }).id);
  for (const r of byName ?? []) ids.add((r as { id: string }).id);
  // Cap to keep the generated PostgREST URL within reasonable length.
  return [...ids].slice(0, 300);
}

/** Build a PostgREST `.or()` group for the free-text search. */
function buildSearchOrFilter(search: string, driverIds: string[]): string {
  const cleaned = search.replace(/[,()*"\\%]/g, " ").trim();
  const parts: string[] = [];
  if (cleaned) parts.push(`external_order_id.ilike.*${cleaned}*`);
  if (driverIds.length > 0) parts.push(`driver_id.in.(${driverIds.join(",")})`);
  const hex = search.trim().toLowerCase();
  if (/^[0-9a-f]{1,8}$/.test(hex)) {
    const lo = `${hex.padEnd(8, "0")}-0000-0000-0000-000000000000`;
    const hi = `${hex.padEnd(8, "f")}-ffff-ffff-ffff-ffffffffffff`;
    parts.push(`and(id.gte.${lo},id.lte.${hi})`);
  }
  if (parts.length === 0) {
    // No resolvable predicate — force an empty result rather than match all.
    parts.push("id.eq.00000000-0000-0000-0000-000000000000");
  }
  return parts.join(",");
}

/** Build a PostgREST `.or()` group for the cancel-reason sub-filter. */
function buildCancelReasonOrFilter(code: string): string {
  const concrete = CANCEL_REASON_CODES.filter((c) => c !== "other");
  if (code === "other") {
    const conds = ["cancel_reason.not.is.null"];
    for (const c of concrete) conds.push(`cancel_reason.not.like.${c}*`);
    return `and(${conds.join(",")})`;
  }
  // Stored as `code` or `code|note` — prefix match covers both.
  return `cancel_reason.like.${code}*`;
}

async function fetchGpsMockFlagsByDeliveryIds(
  deliveryIds: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (deliveryIds.length === 0) return result;

  const admin = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => Record<string, unknown>;
    };
  };

  const byDeliveryIdQuery = admin
    .from("driver_location_events")
    .select("delivery_id, is_mocked, recorded_at") as {
    in: (
      column: string,
      values: string[],
    ) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };

  const { data: byDeliveryId, error: err1 } = await byDeliveryIdQuery
    .in("delivery_id", deliveryIds)
    .order("recorded_at", { ascending: false });

  if (err1) {
    console.error("[fetchDeliveriesForAdmin] gps mock by delivery_id failed", err1);
  } else {
    for (const row of (byDeliveryId ?? []) as unknown as Array<{
      delivery_id: string | null;
      is_mocked: boolean | null;
    }>) {
      if (!row.delivery_id || result.has(row.delivery_id)) continue;
      if (row.is_mocked === true) result.set(row.delivery_id, true);
      else if (!result.has(row.delivery_id)) result.set(row.delivery_id, false);
    }
  }

  const missing = deliveryIds.filter((id) => !result.has(id));
  if (missing.length > 0) {
    const byActiveIdQuery = admin
      .from("driver_location_events")
      .select("active_delivery_id, is_mocked, recorded_at") as {
      in: (
        column: string,
        values: string[],
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };

    const { data: byActiveId, error: err2 } = await byActiveIdQuery
      .in("active_delivery_id", missing)
      .order("recorded_at", { ascending: false });

    if (err2) {
      console.error("[fetchDeliveriesForAdmin] gps mock by active_delivery_id failed", err2);
    } else {
      for (const row of (byActiveId ?? []) as unknown as Array<{
        active_delivery_id: string | null;
        is_mocked: boolean | null;
      }>) {
        const id = row.active_delivery_id;
        if (!id || result.has(id)) continue;
        if (row.is_mocked === true) result.set(id, true);
        else if (!result.has(id)) result.set(id, false);
      }
    }
  }

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
  return {
    url: resolved?.url ?? null,
    contentType: resolved?.contentType ?? null,
  };
}

export type ResolvedDeliveryProof = {
  url: string | null;
  contentType: string | null;
};

/** Presigned proof URLs for the detail modal. Fast path — no DB lookups. */
export async function fetchDeliveryDetailExtras(params: {
  deliveryId: string;
  proofKeys: string[];
}): Promise<{
  proofs: Record<string, ResolvedDeliveryProof>;
}> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveryDetailExtras", {
    deliveryId: params.deliveryId,
  });

  const uniqueKeys = [
    ...new Set(params.proofKeys.map((k) => k.trim()).filter(Boolean)),
  ];

  const proofEntries = await Promise.all(
    uniqueKeys.map(async (key) => {
      const resolved = await resolveOrderProofUrl(key);
      return {
        key,
        url: resolved?.url ?? null,
        contentType: resolved?.contentType ?? null,
      };
    }),
  );

  const proofs: Record<string, ResolvedDeliveryProof> = {};
  for (const entry of proofEntries) {
    proofs[entry.key] = { url: entry.url, contentType: entry.contentType };
  }

  return { proofs };
}

/** GPS audit event for the detail modal. Loaded independently from proofs. */
export async function fetchDeliveryGpsAudit(
  deliveryId: string,
): Promise<{ gpsEvent: DriverLocationEvent | null }> {
  await requireDeliveriesView();

  let gpsEvent: DriverLocationEvent | null = null;
  try {
    gpsEvent = await fetchLocationEventByDeliveryId(deliveryId);
  } catch (err) {
    console.error("[fetchDeliveryGpsAudit] gps event lookup failed", err);
  }

  return { gpsEvent };
}

/**
 * Fetch every delivery (used by the dashboard feed/metrics). Intentionally
 * skips per-row proof/logo presigning and GPS-mock scanning — those are only
 * needed by the deliveries detail view, which resolves them lazily.
 */
export async function fetchDeliveriesForAdmin(): Promise<DeliveryListRow[]> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveriesForAdmin");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_LIST_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as DeliveryDbRowForList[];
  const mapped = await mapDeliveryDbRowsToListRows(rows, new Map(), {
    resolveAssets: false,
  });
  const enriched = await enrichDeliveryListRows(supabase, mapped);
  return sortDeliveriesByActivity(enriched);
}

/**
 * Fetch one page of deliveries for the infinite-scroll list. Filters, search,
 * ordering, and pagination all run in Postgres; only the current page's rows
 * are mapped, and GPS-mock badges are resolved for just those rows.
 */
export async function fetchDeliveriesPage(
  params: DeliveriesQueryFilter & { offset?: number },
): Promise<DeliveriesPage> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveriesPage");
  const supabase = await createClient();

  const offset = Math.max(0, params.offset ?? 0);
  const limit = DELIVERIES_PAGE_SIZE;

  const search = params.search?.trim() ?? "";
  const searchDriverIds = search ? await resolveSearchDriverIds(supabase, search) : [];

  let query = supabase.from("deliveries").select(DELIVERY_LIST_SELECT, { count: "exact" });

  if (params.status && params.status !== "all") {
    if (params.status === "in_progress") {
      query = query.in("status", [...IN_PROGRESS_DELIVERY_STATUSES]);
    } else {
      const statusValue = normalizeDeliveryStatusFilter(
        params.status,
      ) as DeliveryStatus;
      query = query.eq("status", statusValue);
    }
  }
  if (params.zoneId && params.zoneId !== "all") query = query.eq("zone_id", params.zoneId);
  if (params.partnerId && params.partnerId !== "all") {
    query = query.eq("partner_id", params.partnerId);
  }
  if (params.cancelReason && params.cancelReason !== "all") {
    query = query.or(buildCancelReasonOrFilter(params.cancelReason));
  }
  if (params.dateFrom) query = query.gte("created_at", params.dateFrom);
  if (params.dateTo) query = query.lte("created_at", params.dateTo);
  if (search) {
    query = query.or(buildSearchOrFilter(search, searchDriverIds));
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const rows = (data ?? []) as unknown as DeliveryDbRowForList[];
  const gpsFlags = await fetchGpsMockFlagsByDeliveryIds(rows.map((r) => r.id));
  const mapped = await mapDeliveryDbRowsToListRows(rows, gpsFlags, {
    resolveAssets: false,
  });
  // Keep the server (created_at desc) order — re-sorting would break paging.
  const enriched = await enrichDeliveryListRows(supabase, mapped);

  return {
    rows: enriched,
    nextOffset: rows.length === limit ? offset + limit : null,
    total: count ?? 0,
  };
}

/** Global status counts for the KPI strip (independent of list filters). */
export async function fetchDeliveriesKpis(): Promise<DeliveriesKpiCounts> {
  await requireDeliveriesView();
  const supabase = await createClient();

  const countFor = async (status?: DeliveryStatus): Promise<number> => {
    let q = supabase.from("deliveries").select("id", { count: "exact", head: true });
    if (status) q = q.eq("status", status);
    const { count } = await q;
    return count ?? 0;
  };

  const [total, active, verified, pending, rejected, cancelled] = await Promise.all([
    countFor(),
    countFor("in_transit"),
    countFor("verified"),
    countFor("pending"),
    countFor("rejected"),
    countFor("cancelled"),
  ]);

  return { total, active, verified, pending, rejected, cancelled };
}

/** Zone + partner options for the list filters. */
export async function fetchDeliveryFilterOptions(): Promise<DeliveryFilterOptions> {
  await requireDeliveriesView();
  const supabase = await createClient();

  const [{ data: zones }, { data: partners }] = await Promise.all([
    supabase.from("zones").select("id, name").order("name", { ascending: true }),
    supabase.from("partners").select("id, name").order("name", { ascending: true }),
  ]);

  return {
    zones: (zones ?? []).map((z) => ({ id: (z as { id: string }).id, name: (z as { name: string }).name })),
    partners: (partners ?? []).map((p) => ({
      id: (p as { id: string }).id,
      name: (p as { name: string }).name,
    })),
  };
}

/** Fetch all matching rows (lightweight) for CSV export, honoring filters. */
export async function fetchDeliveriesForExport(
  params: DeliveriesQueryFilter,
): Promise<DeliveryExportRow[]> {
  await requireDeliveriesView();
  void logAdminRead("deliveries", "fetchDeliveriesForExport");
  const supabase = await createClient();

  const EXPORT_CAP = 10000;
  const search = params.search?.trim() ?? "";
  const searchDriverIds = search ? await resolveSearchDriverIds(supabase, search) : [];

  let query = supabase
    .from("deliveries")
    .select(
      `
      id,
      status,
      external_order_id,
      pickup_at,
      delivered_at,
      cancelled_at,
      cancel_reason,
      drivers (driver_code, employee_id, profiles (full_name)),
      restaurants (name),
      zones (name)
    `,
    );

  if (params.status && params.status !== "all") {
    if (params.status === "in_progress") {
      query = query.in("status", [...IN_PROGRESS_DELIVERY_STATUSES]);
    } else {
      const statusValue = normalizeDeliveryStatusFilter(
        params.status,
      ) as DeliveryStatus;
      query = query.eq("status", statusValue);
    }
  }
  if (params.zoneId && params.zoneId !== "all") query = query.eq("zone_id", params.zoneId);
  if (params.partnerId && params.partnerId !== "all") {
    query = query.eq("partner_id", params.partnerId);
  }
  if (params.cancelReason && params.cancelReason !== "all") {
    query = query.or(buildCancelReasonOrFilter(params.cancelReason));
  }
  if (params.dateFrom) query = query.gte("created_at", params.dateFrom);
  if (params.dateTo) query = query.lte("created_at", params.dateTo);
  if (search) {
    query = query.or(buildSearchOrFilter(search, searchDriverIds));
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(0, EXPORT_CAP - 1);

  if (error) throw error;

  type ExportDbRow = {
    id: string;
    status: DeliveryStatus;
    external_order_id: string | null;
    pickup_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    drivers:
      | { driver_code: string; employee_id: string | null; profiles: { full_name: string | null } | { full_name: string | null }[] | null }
      | { driver_code: string; employee_id: string | null; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]
      | null;
    restaurants: { name: string } | { name: string }[] | null;
    zones: { name: string } | { name: string }[] | null;
  };

  return ((data ?? []) as unknown as ExportDbRow[]).map((row) => {
    const driverRel = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    const profileRel = driverRel?.profiles;
    const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;
    return {
      short_id: shortId(row.id),
      driver_name: profile?.full_name ?? "—",
      driver_code: driverRel?.driver_code ?? "—",
      driver_employee_id: driverRel?.employee_id ?? "—",
      restaurant_name: relName(row.restaurants) === "—" ? null : relName(row.restaurants),
      zone_name: relName(row.zones),
      status: row.status,
      external_order_id: row.external_order_id,
      pickup_at: row.pickup_at,
      delivered_at: row.delivered_at,
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
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

  const supabase = await createClient();
  const safeLimit = Math.max(1, Math.min(limit, 10));
  const { data, error } = await supabase
    .from("deliveries")
    .select(
      `
      id,
      driver_id,
      status,
      delivered_at,
      created_at,
      external_order_id,
      partners (name)
    `,
    )
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<
    RecentDeliveryDbRow & { created_at: string; external_order_id: string | null }
  >;
  return rows.map((row) => ({
    id: row.id,
    driver_id: row.driver_id,
    short_id: shortId(row.id),
    status: row.status,
    partner_name: relName(row.partners),
    delivered_at: row.delivered_at,
    created_at: row.created_at,
    external_order_id: row.external_order_id,
  }));
}

export async function updateDeliveryStatus(
  deliveryId: string,
  status: ReviewableDeliveryStatus,
  rejectionReason?: string,
): Promise<DeliveryMutationResult> {
  const session = await requireDeliveriesManage();
  if (!session) return { error: "not_authorized" };

  if (status === "rejected") {
    const trimmed = rejectionReason?.trim() ?? "";
    if (!trimmed) return { error: "reason_required" };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("deliveries")
    .select("id, driver_id, delivered_at, status, partner_id, restaurant_id")
    .eq("id", deliveryId)
    .maybeSingle();

  if (fetchError || !existing) {
    return {
      error: "update_failed",
      errorDetail: formatPgErrorDetail(fetchError),
    };
  }

  if (
    (existing.status as DeliveryStatus) === "in_transit" ||
    (existing.status as DeliveryStatus) === "cancelled"
  ) {
    return { error: "invalid_status" };
  }

  const updatePayload =
    status === "rejected"
      ? {
          status: "rejected" as const,
          rejection_reason: rejectionReason!.trim(),
        }
      : {
          status,
          rejection_reason: null,
        };

  const resolvedRestaurantId =
    status === "verified"
      ? await resolveDeliveryRestaurantId(supabase, {
          driver_id: existing.driver_id,
          partner_id: (existing as { partner_id: string | null }).partner_id ?? null,
          restaurant_id: (existing as { restaurant_id: string | null }).restaurant_id ?? null,
        })
      : null;
  if (resolvedRestaurantId && status !== "rejected") {
    (updatePayload as Record<string, unknown>).restaurant_id = resolvedRestaurantId;
  }

  const { error } = await supabase
    .from("deliveries")
    .update(updatePayload)
    .eq("id", deliveryId);

  if (error) {
    return {
      error: "update_failed",
      errorDetail: formatPgErrorDetail(error),
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

  const affectsEarnings =
    existing.status === "verified" ||
    status === "verified";
  if (affectsEarnings && existing.delivered_at) {
    await recalcEarningsForDelivery(
      supabase,
      existing.driver_id,
      existing.delivered_at,
    );
  }

  // Mirror the admin's decision into DPD verifications so the verification
  // page stays in sync without a manual entry.
  await syncVerificationForDelivery(
    supabase,
    {
      id: existing.id,
      driver_id: existing.driver_id,
      delivered_at: existing.delivered_at ?? new Date().toISOString(),
      partner_id: (existing as { partner_id: string | null }).partner_id ?? null,
      restaurant_id:
        resolvedRestaurantId ??
        ((existing as { restaurant_id: string | null }).restaurant_id ?? null),
    },
    session.id,
  );

  return { ok: true };
}

export async function verifyDelivery(
  deliveryId: string,
): Promise<DeliveryMutationResult> {
  return updateDeliveryStatus(deliveryId, "verified");
}

export async function rejectDelivery(
  deliveryId: string,
  reason: string,
): Promise<DeliveryMutationResult> {
  return updateDeliveryStatus(deliveryId, "rejected", reason);
}

export async function deleteDelivery(
  deliveryId: string,
): Promise<DeliveryMutationResult> {
  const session = await requireSuperAdmin();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { data: row, error: fetchError } = await supabase
    .from("deliveries")
    .select("id, driver_id, delivered_at, order_proof_url, status")
    .eq("id", deliveryId)
    .maybeSingle();

  if (fetchError || !row) {
    return {
      error: "delete_failed",
      errorDetail: formatPgErrorDetail(fetchError),
    };
  }

  const proofKey = row.order_proof_url?.trim() ?? "";

  if (proofKey && isR2ObjectKey(proofKey)) {
    try {
      await deleteObject(proofKey);
    } catch {
      /* best-effort R2 cleanup */
    }
    try {
      const admin = createAdminClient();
      await admin.from("storage_uploads").delete().eq("object_key", proofKey);
    } catch {
      /* best-effort audit cleanup */
    }
  }

  const { error: deleteError } = await supabase
    .from("deliveries")
    .delete()
    .eq("id", deliveryId);

  if (deleteError) {
    return {
      error: "delete_failed",
      errorDetail: formatPgErrorDetail(deleteError),
    };
  }

  void logAdminMutation({
    action: "delete",
    entityType: "delivery",
    entityId: deliveryId,
    routeName: "deleteDelivery",
    before: {
      status: row.status,
      driver_id: row.driver_id,
      delivered_at: row.delivered_at,
    },
  });

  if (row.status === "verified" && row.delivered_at) {
    await recalcEarningsForDelivery(supabase, row.driver_id, row.delivered_at);
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

  const supabase = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => Record<string, unknown>;
    };
  };

  const liveQuery = supabase
    .from("driver_locations")
    .select(
      "latitude, longitude, last_seen_at, is_mocked, heading_deg, active_delivery_id",
    ) as {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => Promise<{
        data: Record<string, unknown> | null;
        error: { message: string } | null;
      }>;
    };
  };

  const { data, error } = await liveQuery.eq("driver_id", driverId).maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    latitude: number | string;
    longitude: number | string;
    last_seen_at: string;
    is_mocked: boolean | null;
    heading_deg: number | string | null;
    active_delivery_id: string | null;
  };

  if (row.active_delivery_id && row.active_delivery_id !== deliveryId) {
    return null;
  }

  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    lastSeenAt: row.last_seen_at,
    isMocked: row.is_mocked,
    headingDeg: row.heading_deg != null ? Number(row.heading_deg) : null,
  };
}
