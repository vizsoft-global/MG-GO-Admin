"use server";

import type { Firestore } from "firebase-admin/firestore";
import type { Database } from "@/types/database";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type {
  ImportMappedRow,
  ImportPreviewRow,
  VerificationActionError,
  VerificationDetailModel,
  VerificationDriverOption,
  VerificationExportData,
  VerificationImportBatchRow,
  VerificationListCursor,
  VerificationListFilters,
  VerificationListRow,
  VerificationListStats,
} from "./types";

const PAGE_SIZE = 50;

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

async function requireVerificationsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "verifications.view",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireVerificationsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "verifications.manage",
      session.isSuperAdmin,
    )
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

function formatPgErrorDetail(error: PgLikeError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function logPgError(scope: string, error: PgLikeError | null | undefined): void {
  if (!error) return;
  console.error(`[verifications] ${scope}:`, formatPgErrorDetail(error));
}

function driverNameFromRow(
  drivers:
    | {
        driver_code: string;
        employee_id: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }
    | {
        driver_code: string;
        employee_id: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }[]
    | null,
): { name: string; code: string; employee_id: string | null } {
  const d = Array.isArray(drivers) ? drivers[0] : drivers;
  if (!d) return { name: "—", code: "—", employee_id: null };
  const prof = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
  return {
    name: prof?.full_name ?? "—",
    code: d.driver_code,
    employee_id: d.employee_id ?? null,
  };
}

function sanitizeSearchTerm(term: string): string {
  return term.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

function pgFail(err: unknown): PgLikeError {
  const error = err as { code?: string; message?: string };
  const code = error?.code === "already-exists" ? "23505" : error?.code;
  return { code: code ?? null, message: error?.message ?? String(err) };
}

async function verifyDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

function includesCi(value: unknown, term: string): boolean {
  return String(value ?? "").toLowerCase().includes(term.toLowerCase());
}

type SearchHits = { driverIds: Set<string>; restaurantIds: Set<string>; partnerIds: Set<string> };

async function buildVerificationSearchOrFilter(
  db: Firestore,
  search: string | undefined,
): Promise<"empty" | SearchHits | null> {
  const term = sanitizeSearchTerm(search ?? "");
  if (!term) return null;
  const driverIds = new Set<string>();
  const restaurantIds = new Set<string>();
  const partnerIds = new Set<string>();
  const [drivers, restaurants, partners, profiles] = await Promise.all([
    db.collection(COLLECTIONS.drivers).limit(2000).get(),
    db.collection(COLLECTIONS.restaurants).limit(2000).get(),
    db.collection(COLLECTIONS.partners).limit(500).get(),
    db.collection(COLLECTIONS.profiles).limit(2000).get(),
  ]);
  for (const doc of drivers.docs) {
    const row = doc.data();
    if (includesCi(row.driver_code, term) || includesCi(row.employee_id, term)) {
      if (driverIds.size < 200) driverIds.add(doc.id);
    }
  }
  for (const doc of profiles.docs) {
    if (includesCi(doc.data().full_name, term) && driverIds.size < 200) driverIds.add(doc.id);
  }
  for (const doc of restaurants.docs) {
    if (includesCi(doc.data().name, term) && restaurantIds.size < 200) restaurantIds.add(doc.id);
  }
  for (const doc of partners.docs) {
    if (includesCi(doc.data().name, term) && partnerIds.size < 100) partnerIds.add(doc.id);
  }
  if (driverIds.size === 0 && restaurantIds.size === 0 && partnerIds.size === 0) return "empty";
  return { driverIds, restaurantIds, partnerIds };
}

type VerificationDoc = {
  id: string;
  driver_id: string;
  restaurant_id: string;
  partner_id: string;
  service_date: string;
  reported_count: number;
  matched_count: number;
  under_review_count: number;
  shortfall_count: number;
  status: string;
  source: string;
  notes: string | null;
  reconciled_at: string | null;
  created_at: string;
  import_batch_id?: string | null;
};

function verificationFromDoc(id: string, row: Record<string, unknown>): VerificationDoc {
  return {
    id,
    driver_id: String(row.driver_id ?? ""),
    restaurant_id: String(row.restaurant_id ?? ""),
    partner_id: String(row.partner_id ?? ""),
    service_date: String(row.service_date ?? ""),
    reported_count: Number(row.reported_count ?? 0),
    matched_count: Number(row.matched_count ?? 0),
    under_review_count: Number(row.under_review_count ?? 0),
    shortfall_count: Number(row.shortfall_count ?? 0),
    status: String(row.status ?? ""),
    source: String(row.source ?? ""),
    notes: (row.notes as string | null) ?? null,
    reconciled_at: isoOf(row.reconciled_at),
    created_at: isoOf(row.created_at) ?? "",
    import_batch_id: (row.import_batch_id as string | null) ?? null,
  };
}

function matchesVerificationFilters(row: VerificationDoc, filters: VerificationListFilters): boolean {
  if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
  if ((!filters.status || filters.status === "all") && filters.tab && filters.tab !== "all") {
    if (filters.tab === "needs_action" && !["pending", "deficit", "conflict", "surplus"].includes(row.status)) {
      return false;
    }
    if (filters.tab === "matched" && row.status !== "matched") return false;
    if (filters.tab === "deficit" && row.status !== "deficit") return false;
    if (filters.tab === "pending" && row.status !== "pending") return false;
  }
  if (filters.dateFrom && row.service_date < filters.dateFrom) return false;
  if (filters.dateTo && row.service_date > filters.dateTo) return false;
  if (filters.driverId && row.driver_id !== filters.driverId) return false;
  if (filters.restaurantId && row.restaurant_id !== filters.restaurantId) return false;
  if (filters.partnerId && row.partner_id !== filters.partnerId) return false;
  if (filters.source && filters.source !== "all" && row.source !== filters.source) return false;
  return true;
}

async function namesById(db: Firestore, collection: string, ids: string[], field: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    const found = refs.length ? await db.getAll(...refs) : [];
    for (const doc of found) {
      if (!doc.exists) continue;
      out.set(doc.id, String(doc.data()?.[field] ?? ""));
    }
  }
  return out;
}

async function hydrateVerificationRows(db: Firestore, docs: VerificationDoc[]): Promise<VerificationListRow[]> {
  const driverIds = [...new Set(docs.map((row) => row.driver_id).filter(Boolean))];
  const restaurantIds = [...new Set(docs.map((row) => row.restaurant_id).filter(Boolean))];
  const partnerIds = [...new Set(docs.map((row) => row.partner_id).filter(Boolean))];
  const [codes, employees, names, restaurants, partners] = await Promise.all([
    namesById(db, COLLECTIONS.drivers, driverIds, "driver_code"),
    namesById(db, COLLECTIONS.drivers, driverIds, "employee_id"),
    namesById(db, COLLECTIONS.profiles, driverIds, "full_name"),
    namesById(db, COLLECTIONS.restaurants, restaurantIds, "name"),
    namesById(db, COLLECTIONS.partners, partnerIds, "name"),
  ]);
  return docs.map((row) =>
    mapVerificationRow({
      ...row,
      drivers: {
        driver_code: codes.get(row.driver_id) ?? "—",
        employee_id: employees.get(row.driver_id) ?? null,
        profiles: { full_name: names.get(row.driver_id) ?? null },
      },
      restaurants: { name: restaurants.get(row.restaurant_id) ?? "—" },
      partners: { name: partners.get(row.partner_id) ?? "—" },
    }),
  );
}

async function loadVerificationDocs(db: Firestore): Promise<VerificationDoc[]> {
  const snap = await db.collection(COLLECTIONS.deliveryVerifications).get();
  return snap.docs.map((doc) => verificationFromDoc(doc.id, doc.data()));
}

export async function fetchVerificationListStats(
  filters: Pick<VerificationListFilters, "dateFrom" | "dateTo" | "partnerId"> = {},
): Promise<VerificationListStats> {
  await requireVerificationsView();
  const db = await verifyDb();

  type VerificationStatusValue = NonNullable<
    Database["public"]["Tables"]["delivery_verifications"]["Row"]["status"]
  >;
  const rows = await loadVerificationDocs(db);
  const countFor = async (status?: VerificationStatusValue) =>
    rows.filter((row) => {
      if (filters.dateFrom && row.service_date < filters.dateFrom) return false;
      if (filters.dateTo && row.service_date > filters.dateTo) return false;
      if (filters.partnerId && row.partner_id !== filters.partnerId) return false;
      if (status && row.status !== status) return false;
      return true;
    }).length;

  const [total, matched, deficit, pending, conflict, surplus] = await Promise.all([
    countFor(),
    countFor("matched"),
    countFor("deficit"),
    countFor("pending"),
    countFor("conflict"),
    countFor("surplus"),
  ]);

  return {
    total,
    matched,
    deficit,
    pending,
    conflict,
    surplus,
    needs_action: pending + deficit + conflict + surplus,
  };
}

function mapVerificationRow(row: Record<string, unknown>): VerificationListRow {
  const driverInfo = driverNameFromRow(
    row.drivers as Parameters<typeof driverNameFromRow>[0],
  );
  return {
    id: String(row.id),
    driver_id: String(row.driver_id),
    driver_name: driverInfo.name,
    driver_code: driverInfo.code,
    employee_id: driverInfo.employee_id,
    restaurant_id: String(row.restaurant_id),
    restaurant_name: relName(
      row.restaurants as { name: string } | { name: string }[] | null,
    ),
    partner_id: String(row.partner_id),
    partner_name: relName(
      row.partners as { name: string } | { name: string }[] | null,
    ),
    service_date: String(row.service_date),
    reported_count: Number(row.reported_count),
    matched_count: Number(row.matched_count),
    under_review_count: Number(row.under_review_count),
    shortfall_count: Number(row.shortfall_count),
    status: row.status as VerificationListRow["status"],
    source: row.source as VerificationListRow["source"],
    notes: (row.notes as string | null) ?? null,
    reconciled_at: (row.reconciled_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

export async function listVerifications(params: {
  filters?: VerificationListFilters;
  limit?: number;
  page?: number;
}): Promise<{ rows: VerificationListRow[]; totalCount: number; hasMore: boolean }> {
  await requireVerificationsView();
  void logAdminRead("delivery_verifications", "listVerifications", {
    filters: params.filters ?? {},
  });
  const db = await verifyDb();
  const filters = params.filters ?? {};
  const limit = params.limit ?? PAGE_SIZE;
  const page = params.page ?? 0;
  const from = page * limit;

  const searchFilter = await buildVerificationSearchOrFilter(db, filters.search);
  if (searchFilter === "empty") {
    return { rows: [], totalCount: 0, hasMore: false };
  }

  const sortBy = filters.sortBy ?? "service_date";
  const sortDir = filters.sortDir ?? "desc";
  const ascending = sortDir === "asc";
  const matched = (await loadVerificationDocs(db)).filter((row) => {
    if (!matchesVerificationFilters(row, filters)) return false;
    if (!searchFilter) return true;
    return (
      searchFilter.driverIds.has(row.driver_id) ||
      searchFilter.restaurantIds.has(row.restaurant_id) ||
      searchFilter.partnerIds.has(row.partner_id)
    );
  });
  matched.sort((a, b) => {
    const av = String((a as Record<string, unknown>)[sortBy] ?? "");
    const bv = String((b as Record<string, unknown>)[sortBy] ?? "");
    const cmp = av.localeCompare(bv);
    if (cmp !== 0) return ascending ? cmp : -cmp;
    return b.id.localeCompare(a.id);
  });
  const pageRows = matched.slice(from, from + limit);
  const rows = await hydrateVerificationRows(db, pageRows);
  const totalCount = matched.length;
  const hasMore = from + rows.length < totalCount;

  return { rows, totalCount, hasMore };
}

export async function fetchVerificationDetail(
  id: string,
): Promise<VerificationDetailModel | null> {
  await requireVerificationsView();
  const db = await verifyDb();
  const doc = await db.collection(COLLECTIONS.deliveryVerifications).doc(id).get();
  if (!doc.exists) return null;
  const [base] = await hydrateVerificationRows(db, [verificationFromDoc(doc.id, doc.data() ?? {})]);
  if (!base) return null;

  const balanceSnap = await db
    .collection("verification_balances")
    .where("driver_id", "==", base.driver_id)
    .get();
  const balance = balanceSnap.docs
    .map((item) => item.data())
    .find((row) => String(row.restaurant_id ?? "") === base.restaurant_id);

  const startIso = `${base.service_date}T00:00:00+03:00`;
  const endIso = `${base.service_date}T23:59:59.999+03:00`;
  const deliverySnap = await db
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", base.driver_id)
    .get();
  const deliveries = deliverySnap.docs
    .map((item) => {
      const row = item.data();
      return {
        id: item.id,
        status: row.status as string | undefined,
        delivered_at: row.delivered_at as unknown,
        external_order_id: (row.external_order_id as string | null) ?? null,
        restaurant_id: (row.restaurant_id as string | null) ?? null,
        partner_id: (row.partner_id as string | null) ?? null,
      };
    })
    .filter((row) => {
      const at = isoOf(row.delivered_at);
      return at != null && at >= startIso && at <= endIso;
    })
    .sort((a, b) => (isoOf(a.delivered_at) ?? "").localeCompare(isoOf(b.delivered_at) ?? ""));

  const scoped = deliveries.filter(
    (d) =>
      d.restaurant_id === base.restaurant_id ||
      (d.restaurant_id == null && d.partner_id === base.partner_id),
  );

  return {
    ...base,
    balance_count: Number(balance?.balance_count ?? 0),
    deliveries: scoped.map((d) => ({
      id: d.id,
      short_id: shortId(d.id),
      status: String(d.status ?? ""),
      delivered_at: isoOf(d.delivered_at),
      external_order_id: (d.external_order_id as string | null) ?? null,
    })),
  };
}

export async function fetchVerificationDriverOptions(
  search?: string,
): Promise<VerificationDriverOption[]> {
  await requireVerificationsView();
  const db = await verifyDb();
  const term = sanitizeSearchTerm(search ?? "");
  const snap = await db.collection(COLLECTIONS.drivers).limit(2000).get();
  const nameIds = snap.docs.map((doc) => doc.id);
  const names = await namesById(db, COLLECTIONS.profiles, nameIds.slice(0, 500), "full_name");
  return snap.docs
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        driver_code: String(row.driver_code ?? ""),
        employee_id: (row.employee_id as string | null) ?? null,
        full_name: names.get(doc.id) || "—",
        partner_id: (row.partner_id as string | null) ?? null,
      };
    })
    .filter((row) => {
      if (!term) return true;
      return (
        includesCi(row.driver_code, term) ||
        includesCi(row.employee_id, term) ||
        includesCi(row.full_name, term)
      );
    })
    .sort((a, b) => a.driver_code.localeCompare(b.driver_code))
    .slice(0, 100);
}

export type DriverAssignedRestaurant = {
  id: string;
  name: string;
  partner_id: string | null;
  partner_name: string;
  status: string;
};

export async function fetchDriverAssignedRestaurants(
  driverId: string,
): Promise<DriverAssignedRestaurant[]> {
  await requireVerificationsView();
  if (!driverId) return [];

  const db = await verifyDb();
  const [directSnap, driverDoc] = await Promise.all([
    db.collection(COLLECTIONS.driverRestaurants).where("driver_id", "==", driverId).get(),
    db.collection(COLLECTIONS.drivers).doc(driverId).get(),
  ]);
  const directIds = new Set(directSnap.docs.map((doc) => String(doc.data().restaurant_id ?? "")));
  const partnerId = (driverDoc.data()?.partner_id as string | null) ?? null;
  const intakeSnap = await db.collection("driver_intakes").where("linked_profile_id", "==", driverId).get();
  const intake = intakeSnap.docs
    .filter((doc) => doc.data().archived_at == null)
    .sort((a, b) => (isoOf(b.data().created_at) ?? "").localeCompare(isoOf(a.data().created_at) ?? ""))[0];
  if (intake) {
    const intakeRows = await db.collection("driver_intake_restaurants").where("intake_id", "==", intake.id).get();
    for (const row of intakeRows.docs) directIds.add(String(row.data().restaurant_id ?? ""));
  }
  if (directIds.size === 0 && !partnerId) return [];
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).get();
  const chosen = restaurantSnap.docs.filter((doc) =>
    directIds.size > 0 ? directIds.has(doc.id) : doc.data().partner_id === partnerId,
  );
  const partnerNames = await namesById(
    db,
    COLLECTIONS.partners,
    [...new Set(chosen.map((doc) => String(doc.data().partner_id ?? "")).filter(Boolean))],
    "name",
  );
  return chosen
    .map((doc) => {
      const row = doc.data();
      const pid = (row.partner_id as string | null) ?? null;
      return {
        id: doc.id,
        name: String(row.name ?? "—"),
        partner_id: pid,
        partner_name: pid ? partnerNames.get(pid) ?? "—" : "—",
        status: String(row.status ?? "draft"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type VerificationMutationResult =
  | { success: true; id: string }
  | { error: VerificationActionError; errorDetail?: string };

export async function createVerification(input: {
  driverId: string;
  restaurantId: string;
  serviceDate: string;
  reportedCount: number;
  notes?: string;
}): Promise<VerificationMutationResult> {
  const session = await requireVerificationsManage();
  if (!session) return { error: "not_authorized" };

  const { driverId, restaurantId, serviceDate, reportedCount, notes } = input;
  if (!driverId || !restaurantId || !serviceDate) {
    return { error: "missing_fields" };
  }
  if (!Number.isFinite(reportedCount) || reportedCount < 0) {
    return { error: "invalid_count" };
  }

  const db = await verifyDb();
  const restaurantDoc = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  const restaurant = restaurantDoc.data();
  if (!restaurantDoc.exists || !restaurant) return { error: "restaurant_not_found" };
  if (!restaurant.partner_id) return { error: "restaurant_not_found" };
  const existing = await db
    .collection(COLLECTIONS.deliveryVerifications)
    .where("driver_id", "==", driverId)
    .get();
  const duplicate = existing.docs.some((doc) => {
    const row = doc.data();
    return row.restaurant_id === restaurantId && String(row.service_date) === serviceDate;
  });
  if (duplicate) return { error: "duplicate" };
  const created = db.collection(COLLECTIONS.deliveryVerifications).doc();
  try {
    await created.set({
      driver_id: driverId,
      restaurant_id: restaurantId,
      partner_id: restaurant.partner_id,
      service_date: serviceDate,
      reported_count: reportedCount,
      notes: notes?.trim() || null,
      source: "manual",
      created_by: session.id,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    const error = pgFail(err);
    if (error.code === "23505") return { error: "duplicate" };
    return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
  }
  void logAdminMutation({
    action: "create",
    entityType: "delivery_verification",
    entityId: created.id,
    routeName: "createVerification",
    after: { driver_id: driverId, restaurant_id: restaurantId, service_date: serviceDate },
  });
  return { success: true, id: created.id };
}

export async function updateVerification(input: {
  id: string;
  reportedCount: number;
  notes?: string;
}): Promise<VerificationMutationResult> {
  const session = await requireVerificationsManage();
  if (!session) return { error: "not_authorized" };

  if (!Number.isFinite(input.reportedCount) || input.reportedCount < 0) {
    return { error: "invalid_count" };
  }

  const db = await verifyDb();
  try {
    await db.collection(COLLECTIONS.deliveryVerifications).doc(input.id).set(
      {
        reported_count: input.reportedCount,
        notes: input.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (err) {
    return { error: "save_failed", errorDetail: formatPgErrorDetail(pgFail(err)) };
  }
  void logAdminMutation({
    action: "update",
    entityType: "delivery_verification",
    entityId: input.id,
    routeName: "updateVerification",
    after: { reported_count: input.reportedCount },
  });
  return { success: true, id: input.id };
}

export async function reconcileVerification(
  id: string,
): Promise<VerificationMutationResult> {
  const session = await requireVerificationsManage();
  if (!session) return { error: "not_authorized" };

  const { error } = await callAdminFunction("reconcile_delivery_verification", {
    p_verification_id: id,
    verificationId: id,
  });

  if (error) {
    return {
      error: "reconcile_failed",
      errorDetail: formatPgErrorDetail(pgFail(error)),
    };
  }
  void logAdminMutation({
    action: "update",
    entityType: "delivery_verification",
    entityId: id,
    routeName: "reconcileVerification",
    context: { reconciled: true },
  });
  return { success: true, id };
}

export async function deleteVerification(
  id: string,
): Promise<VerificationMutationResult> {
  const session = await requireSuperAdmin();
  if (!session) return { error: "not_authorized" };

  const db = await verifyDb();
  try {
    await db.collection(COLLECTIONS.deliveryVerifications).doc(id).delete();
  } catch (err) {
    return { error: "delete_failed", errorDetail: formatPgErrorDetail(pgFail(err)) };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "delivery_verification",
    entityId: id,
    routeName: "deleteVerification",
  });
  return { success: true, id };
}

export async function resolveImportPreview(
  rows: ImportMappedRow[],
): Promise<ImportPreviewRow[]> {
  await requireVerificationsManage();
  const db = await verifyDb();
  const [driverSnap, restaurantSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).get(),
    db.collection(COLLECTIONS.restaurants).get(),
  ]);
  const profileNames = await namesById(
    db,
    COLLECTIONS.profiles,
    driverSnap.docs.map((doc) => doc.id),
    "full_name",
  );
  const partnerNames = await namesById(
    db,
    COLLECTIONS.partners,
    [...new Set(restaurantSnap.docs.map((doc) => String(doc.data().partner_id ?? "")).filter(Boolean))],
    "name",
  );
  const drivers = driverSnap.docs.map((doc) => {
    const row = doc.data();
    return {
      id: doc.id,
      driver_code: String(row.driver_code ?? ""),
      employee_id: (row.employee_id as string | null) ?? null,
      partner_id: (row.partner_id as string | null) ?? null,
      profiles: { full_name: profileNames.get(doc.id) ?? null },
    };
  });
  const restaurants = restaurantSnap.docs.map((doc) => {
    const row = doc.data();
    const pid = (row.partner_id as string | null) ?? null;
    return {
      id: doc.id,
      name: String(row.name ?? ""),
      partner_id: pid,
      external_merchant_id: (row.external_merchant_id as string | null) ?? null,
      partners: { name: pid ? partnerNames.get(pid) ?? "—" : "—" },
    };
  });

  type DriverLookup = {
    id: string;
    driver_code: string;
    employee_id: string | null;
    partner_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const driverByEmp = new Map<string, DriverLookup>();
  const driverByCode = new Map<string, DriverLookup>();
  for (const d of drivers ?? []) {
    if (d.employee_id) driverByEmp.set(d.employee_id.trim(), d);
    driverByCode.set(d.driver_code.trim().toLowerCase(), d);
  }

  type RestaurantLookup = {
    id: string;
    name: string;
    partner_id: string | null;
    external_merchant_id: string | null;
    partners: { name: string } | { name: string }[] | null;
  };
  const restaurantByExt = new Map<string, RestaurantLookup>();
  const restaurantsByName = new Map<string, RestaurantLookup[]>();
  for (const r of restaurants ?? []) {
    if (r.external_merchant_id) {
      restaurantByExt.set(String(r.external_merchant_id).trim(), r);
    }
    const key = r.name.trim().toLowerCase();
    const list = restaurantsByName.get(key) ?? [];
    list.push(r);
    restaurantsByName.set(key, list);
  }

  const seen = new Set<string>();

  return rows.map((row) => {
    let status: ImportPreviewRow["status"] = "ok";
    let driver_id: string | null = null;
    let driver_name: string | null = null;
    let restaurant_id: string | null = null;
    let restaurant_resolved_name: string | null = null;

    if (!row.service_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.service_date)) {
      status = "invalid_date";
    } else if (row.reported_count == null || row.reported_count < 0) {
      status = "invalid_count";
    }

    if (status === "ok") {
      const emp = row.employee_id?.trim();
      const code = row.driver_code?.trim().toLowerCase();
      const drv =
        (emp ? driverByEmp.get(emp) : undefined) ??
        (code ? driverByCode.get(code) : undefined);
      if (!drv) status = "unmatched_driver";
      else {
        driver_id = drv.id;
        const prof = Array.isArray(drv.profiles) ? drv.profiles[0] : drv.profiles;
        driver_name = prof?.full_name ?? drv.driver_code;
      }
    }

    if (status === "ok") {
      const ext = row.restaurant_external_id?.trim();
      const rname = row.restaurant_name?.trim().toLowerCase();
      let rest = ext ? restaurantByExt.get(ext) : undefined;
      if (!rest && rname) {
        const candidates = restaurantsByName.get(rname) ?? [];
        const partner = row.partner_name?.trim().toLowerCase();
        rest =
          candidates.find((c) => {
            const p = c.partners as { name: string } | { name: string }[] | null;
            const pname = relName(p).toLowerCase();
            return !partner || pname === partner || partner === "—";
          }) ?? candidates[0];
      }
      if (!rest) status = "unmatched_restaurant";
      else {
        restaurant_id = rest.id;
        restaurant_resolved_name = rest.name;
      }
    }

    if (status === "ok" && driver_id && restaurant_id && row.service_date) {
      const key = `${driver_id}:${restaurant_id}:${row.service_date}`;
      if (seen.has(key)) status = "duplicate";
      else seen.add(key);
    }

    return {
      ...row,
      status,
      driver_id,
      driver_name,
      restaurant_id,
      restaurant_resolved_name,
    };
  });
}

export async function applyImportBatch(payload: {
  fileName: string;
  mapping: Record<string, string>;
  rows: ImportPreviewRow[];
  duplicateStrategy: "skip" | "replace";
}): Promise<
  | {
      success: true;
      batchId: string;
      applied: number;
      skipped: number;
      failures: Array<{ rowIndex: number; reason: string }>;
    }
  | { error: VerificationActionError; errorDetail?: string }
> {
  const session = await requireVerificationsManage();
  if (!session) return { error: "not_authorized" };

  const ready = payload.rows.filter(
    (r) => r.status === "ok" && !r.skip && r.driver_id && r.restaurant_id && r.service_date,
  );
  const preCheckSkipped = payload.rows.length - ready.length;

  const db = await verifyDb();
  const batchRef = db.collection("verification_import_batches").doc();
  try {
    await batchRef.set({
      file_name: payload.fileName,
      mapping: payload.mapping,
      row_count: payload.rows.length,
      applied_count: 0,
      skipped_count: preCheckSkipped,
      status: "applied",
      uploaded_by: session.id,
      uploaded_at: new Date().toISOString(),
    });
  } catch (err) {
    const batchError = pgFail(err);
    logPgError("applyImportBatch.batchInsert", batchError);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(batchError) };
  }
  const batch = { id: batchRef.id };

  let applied = 0;
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  for (const row of ready) {
    const restaurantDoc = await db.collection(COLLECTIONS.restaurants).doc(row.restaurant_id!).get();
    const restaurant = restaurantDoc.data();
    if (!restaurantDoc.exists) {
      failures.push({ rowIndex: row.rowIndex, reason: "restaurant lookup failed" });
      continue;
    }

    if (!restaurant?.partner_id) {
      failures.push({
        rowIndex: row.rowIndex,
        reason: "Restaurant has no partner assigned (cannot insert verification).",
      });
      continue;
    }

    const record = {
      driver_id: row.driver_id!,
      restaurant_id: row.restaurant_id!,
      partner_id: restaurant.partner_id,
      service_date: row.service_date!,
      reported_count: row.reported_count ?? 0,
      notes: row.notes,
      source: "import" as const,
      import_batch_id: batch.id,
      created_by: session.id,
    };

    const existingSnap = await db
      .collection(COLLECTIONS.deliveryVerifications)
      .where("driver_id", "==", record.driver_id)
      .get();
    const existing = existingSnap.docs.find((doc) => {
      const stored = doc.data();
      return stored.restaurant_id === record.restaurant_id && String(stored.service_date) === record.service_date;
    });
    try {
      if (payload.duplicateStrategy === "replace") {
        const ref = existing?.ref ?? db.collection(COLLECTIONS.deliveryVerifications).doc();
        await ref.set(record, { merge: Boolean(existing) });
        applied += 1;
      } else if (existing) {
        failures.push({ rowIndex: row.rowIndex, reason: "Duplicate (skip strategy)" });
      } else {
        await db.collection(COLLECTIONS.deliveryVerifications).doc().set(record);
        applied += 1;
      }
    } catch (err) {
      const error = pgFail(err);
      logPgError("applyImportBatch.write", error);
      failures.push({
        rowIndex: row.rowIndex,
        reason: formatPgErrorDetail(error) ?? error.message ?? "save_failed",
      });
    }
  }

  await batchRef.set(
    {
      applied_count: applied,
      skipped_count: preCheckSkipped + (ready.length - applied),
    },
    { merge: true },
  );

  return {
    success: true,
    batchId: batch.id,
    applied,
    skipped: preCheckSkipped + (ready.length - applied),
    failures,
  };
}

export async function listImportBatches(): Promise<VerificationImportBatchRow[]> {
  await requireVerificationsView();
  const db = await verifyDb();
  const snap = await db.collection("verification_import_batches").get();
  return snap.docs
    .map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        file_name: String(row.file_name ?? ""),
        row_count: Number(row.row_count ?? 0),
        applied_count: Number(row.applied_count ?? 0),
        skipped_count: Number(row.skipped_count ?? 0),
        status: String(row.status ?? ""),
        uploaded_at: isoOf(row.uploaded_at) ?? "",
        reverted_at: isoOf(row.reverted_at),
      } as VerificationImportBatchRow;
    })
    .sort((a, b) => String(b.uploaded_at ?? "").localeCompare(String(a.uploaded_at ?? "")))
    .slice(0, 100);
}

export async function getVerificationExportData(): Promise<VerificationExportData> {
  await requireVerificationsView();
  const db = await verifyDb();
  const snap = await db.collection(COLLECTIONS.restaurants).get();
  const partnerNames = await namesById(
    db,
    COLLECTIONS.partners,
    [...new Set(snap.docs.map((doc) => String(doc.data().partner_id ?? "")).filter(Boolean))],
    "name",
  );
  const zoneIds = [...new Set(snap.docs.map((doc) => String(doc.data().zone_id ?? "")).filter(Boolean))];
  const zoneNames = await namesById(db, COLLECTIONS.zones, zoneIds, "name");
  const zoneCodes = await namesById(db, COLLECTIONS.zones, zoneIds, "code");

  const restaurants = snap.docs.map((doc) => {
    const row = doc.data();
    const partnerId = (row.partner_id as string | null) ?? null;
    const zoneId = (row.zone_id as string | null) ?? null;
    const partnerRel = { name: partnerId ? partnerNames.get(partnerId) ?? "—" : "—" };
    const zoneRel = {
      name: zoneId ? zoneNames.get(zoneId) ?? "—" : "—",
      code: zoneId ? zoneCodes.get(zoneId) ?? "" : "",
    };
    return {
      restaurant_id: doc.id,
      restaurant_name: String(row.name ?? ""),
      restaurant_external_id: (row.external_merchant_id as string | null) ?? null,
      partner_id: partnerId,
      partner_name: partnerRel?.name ?? "—",
      zone_id: zoneId,
      zone_name: zoneRel?.name ?? "—",
      status: String(row.status ?? "draft"),
      zone_code: zoneRel?.code ?? "",
    };
  });

  const zones = restaurants
    .map((restaurant) => ({
      zone_id: restaurant.zone_id ?? "",
      zone_name: restaurant.zone_name,
      zone_code: restaurant.zone_code ?? "",
      restaurant_id: restaurant.restaurant_id,
      restaurant_name: restaurant.restaurant_name,
      restaurant_external_id: restaurant.restaurant_external_id,
      partner_id: restaurant.partner_id,
      partner_name: restaurant.partner_name,
    }))
    .filter((row) => Boolean(row.zone_id));

  const partners = restaurants.map((restaurant) => ({
    partner_id: restaurant.partner_id ?? "",
    partner_name: restaurant.partner_name,
    restaurant_id: restaurant.restaurant_id,
    restaurant_name: restaurant.restaurant_name,
    restaurant_external_id: restaurant.restaurant_external_id,
    zone_id: restaurant.zone_id,
    zone_name: restaurant.zone_name,
  }));

  const sampleSource = restaurants[0];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return {
    restaurants: restaurants.map(({ zone_code: _zoneCode, ...rest }) => rest),
    zones,
    partners,
    sampleImport: [
      {
        employee_id: "EMP10001",
        driver_code: "10001",
        restaurant_external_id: sampleSource?.restaurant_external_id ?? "CC1001",
        restaurant_name: sampleSource?.restaurant_name ?? "Sample Restaurant",
        partner_name: sampleSource?.partner_name ?? "Sample Partner",
        service_date: today,
        reported_count: 12,
        notes: "Sample row for DPD bulk import",
      },
    ],
  };
}

export async function revertImportBatch(
  batchId: string,
): Promise<VerificationMutationResult> {
  const session = await requireSuperAdmin();
  if (!session) return { error: "not_authorized" };

  const db = await verifyDb();
  const batchDoc = await db.collection("verification_import_batches").doc(batchId).get();
  const batch = batchDoc.data();
  if (!batchDoc.exists || !batch) return { error: "batch_not_found" };
  if (batch.status === "reverted") return { error: "batch_already_reverted" };

  const verificationSnap = await db
    .collection(COLLECTIONS.deliveryVerifications)
    .where("import_batch_id", "==", batchId)
    .get();

  for (const doc of verificationSnap.docs) {
    const v = doc.data();
    const startIso = `${String(v.service_date)}T00:00:00+03:00`;
    const endIso = `${String(v.service_date)}T23:59:59.999+03:00`;
    const deliverySnap = await db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", v.driver_id)
      .get();
    for (const delivery of deliverySnap.docs) {
      const row = delivery.data();
      const at = isoOf(row.delivered_at);
      const status = String(row.status ?? "");
      if (!at || at < startIso || at > endIso) continue;
      if (status !== "verified" && status !== "under_review") continue;
      const sameRestaurant = row.restaurant_id === v.restaurant_id;
      const partnerFallback = row.restaurant_id == null && row.partner_id === v.partner_id;
      if (!sameRestaurant && !partnerFallback) continue;
      await delivery.ref.set(
        { status: "pending", updated_at: new Date().toISOString() },
        { merge: true },
      );
    }

    if (Number(v.shortfall_count) > 0) {
      const balSnap = await db.collection("verification_balances").where("driver_id", "==", v.driver_id).get();
      const bal = balSnap.docs.find((item) => item.data().restaurant_id === v.restaurant_id);
      const next = Math.max(0, Number(bal?.data().balance_count ?? 0) - Number(v.shortfall_count));
      if (!bal || next === 0) {
        if (bal) await bal.ref.delete();
      } else {
        await bal.ref.set({ balance_count: next, updated_at: new Date().toISOString() }, { merge: true });
      }
    }

    await doc.ref.delete();
  }

  await batchDoc.ref.set(
    {
      status: "reverted",
      reverted_at: new Date().toISOString(),
      reverted_by: session.id,
    },
    { merge: true },
  );

  return { success: true, id: batchId };
}
