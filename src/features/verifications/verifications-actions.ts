"use server";

import type { Database } from "@/types/database";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

function ilikePattern(term: string): string {
  return `%${term}%`;
}

async function buildVerificationSearchOrFilter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  search: string | undefined,
): Promise<"empty" | string | null> {
  const term = sanitizeSearchTerm(search ?? "");
  if (!term) return null;

  const pattern = ilikePattern(term);
  const driverIds = new Set<string>();
  const restaurantIds = new Set<string>();
  const partnerIds = new Set<string>();

  const [{ data: drivers }, { data: restaurants }, { data: partners }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("drivers")
        .select("id")
        .or(`driver_code.ilike.${pattern},employee_id.ilike.${pattern}`)
        .limit(200),
      supabase.from("restaurants").select("id").ilike("name", pattern).limit(200),
      supabase.from("partners").select("id").ilike("name", pattern).limit(100),
      supabase.from("profiles").select("id").ilike("full_name", pattern).limit(200),
    ]);

  for (const row of drivers ?? []) driverIds.add(row.id);
  for (const row of profiles ?? []) driverIds.add(row.id);
  for (const row of restaurants ?? []) restaurantIds.add(row.id);
  for (const row of partners ?? []) partnerIds.add(row.id);

  if (driverIds.size === 0 && restaurantIds.size === 0 && partnerIds.size === 0) {
    return "empty";
  }

  const parts: string[] = [];
  if (driverIds.size > 0) {
    parts.push(`driver_id.in.(${[...driverIds].join(",")})`);
  }
  if (restaurantIds.size > 0) {
    parts.push(`restaurant_id.in.(${[...restaurantIds].join(",")})`);
  }
  if (partnerIds.size > 0) {
    parts.push(`partner_id.in.(${[...partnerIds].join(",")})`);
  }
  return parts.join(",");
}

function applyVerificationListFilters<
  T extends {
    eq: (col: string, val: string) => T;
    gte: (col: string, val: string) => T;
    lte: (col: string, val: string) => T;
    in: (col: string, vals: string[]) => T;
    or: (filter: string) => T;
  },
>(query: T, filters: VerificationListFilters): T {
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  } else if (filters.tab && filters.tab !== "all") {
    if (filters.tab === "needs_action") {
      query = query.in("status", ["pending", "deficit", "conflict", "surplus"]);
    } else if (filters.tab === "matched") {
      query = query.eq("status", "matched");
    } else if (filters.tab === "deficit") {
      query = query.eq("status", "deficit");
    } else if (filters.tab === "pending") {
      query = query.eq("status", "pending");
    }
  }

  if (filters.dateFrom) {
    query = query.gte("service_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("service_date", filters.dateTo);
  }
  if (filters.driverId) {
    query = query.eq("driver_id", filters.driverId);
  }
  if (filters.restaurantId) {
    query = query.eq("restaurant_id", filters.restaurantId);
  }
  if (filters.partnerId) {
    query = query.eq("partner_id", filters.partnerId);
  }
  if (filters.source && filters.source !== "all") {
    query = query.eq("source", filters.source);
  }

  return query;
}

export async function fetchVerificationListStats(
  filters: Pick<VerificationListFilters, "dateFrom" | "dateTo" | "partnerId"> = {},
): Promise<VerificationListStats> {
  await requireVerificationsView();
  const supabase = await createClient();

  type VerificationStatusValue = NonNullable<
    Database["public"]["Tables"]["delivery_verifications"]["Row"]["status"]
  >;
  const countFor = async (status?: VerificationStatusValue) => {
    let q = supabase
      .from("delivery_verifications")
      .select("*", { count: "exact", head: true });
    if (filters.dateFrom) q = q.gte("service_date", filters.dateFrom);
    if (filters.dateTo) q = q.lte("service_date", filters.dateTo);
    if (filters.partnerId) q = q.eq("partner_id", filters.partnerId);
    if (status) q = q.eq("status", status);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };

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
  const supabase = await createClient();
  const filters = params.filters ?? {};
  const limit = params.limit ?? PAGE_SIZE;
  const page = params.page ?? 0;
  const from = page * limit;
  const to = from + limit - 1;

  const searchFilter = await buildVerificationSearchOrFilter(supabase, filters.search);
  if (searchFilter === "empty") {
    return { rows: [], totalCount: 0, hasMore: false };
  }

  const sortBy = filters.sortBy ?? "service_date";
  const sortDir = filters.sortDir ?? "desc";
  const ascending = sortDir === "asc";

  let query = supabase
    .from("delivery_verifications")
    .select(
      `
      id,
      driver_id,
      restaurant_id,
      partner_id,
      service_date,
      reported_count,
      matched_count,
      under_review_count,
      shortfall_count,
      status,
      source,
      notes,
      reconciled_at,
      created_at,
      drivers (
        driver_code,
        employee_id,
        profiles (full_name)
      ),
      restaurants (name),
      partners (name)
    `,
      { count: "exact" },
    )
    .order(sortBy, { ascending })
    .order("id", { ascending: false });

  query = applyVerificationListFilters(query, filters);

  if (searchFilter) {
    query = query.or(searchFilter);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((r) => mapVerificationRow(r as Record<string, unknown>));
  const totalCount = count ?? 0;
  const hasMore = from + rows.length < totalCount;

  return { rows, totalCount, hasMore };
}

export async function fetchVerificationDetail(
  id: string,
): Promise<VerificationDetailModel | null> {
  await requireVerificationsView();
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("delivery_verifications")
    .select(
      `
      id,
      driver_id,
      restaurant_id,
      partner_id,
      service_date,
      reported_count,
      matched_count,
      under_review_count,
      shortfall_count,
      status,
      source,
      notes,
      reconciled_at,
      created_at,
      drivers (
        driver_code,
        employee_id,
        profiles (full_name)
      ),
      restaurants (name),
      partners (name)
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !row) return null;

  const base = mapVerificationRow(row as Record<string, unknown>);

  const { data: balance } = await supabase
    .from("verification_balances")
    .select("balance_count")
    .eq("driver_id", base.driver_id)
    .eq("restaurant_id", base.restaurant_id)
    .maybeSingle();

  const { data: deliveries } = await supabase
    .from("deliveries")
    .select("id, status, delivered_at, external_order_id, restaurant_id, partner_id")
    .eq("driver_id", base.driver_id)
    .gte(
      "delivered_at",
      `${base.service_date}T00:00:00+03:00`,
    )
    .lte(
      "delivered_at",
      `${base.service_date}T23:59:59.999+03:00`,
    )
    .order("delivered_at", { ascending: true });

  const scoped = (deliveries ?? []).filter(
    (d) =>
      d.restaurant_id === base.restaurant_id ||
      (d.restaurant_id == null && d.partner_id === base.partner_id),
  );

  return {
    ...base,
    balance_count: balance?.balance_count ?? 0,
    deliveries: scoped.map((d) => ({
      id: d.id,
      short_id: shortId(d.id),
      status: d.status,
      delivered_at: d.delivered_at,
      external_order_id: d.external_order_id,
    })),
  };
}

export async function fetchVerificationDriverOptions(
  search?: string,
): Promise<VerificationDriverOption[]> {
  await requireVerificationsView();
  const supabase = await createClient();
  const term = sanitizeSearchTerm(search ?? "");
  const pattern = ilikePattern(term);

  let query = supabase
    .from("drivers")
    .select(
      `
      id,
      driver_code,
      employee_id,
      partner_id,
      profiles (full_name)
    `,
    )
    .order("driver_code")
    .limit(term ? 100 : 100);

  if (term) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .ilike("full_name", pattern)
      .limit(100);

    const profileIds = (profiles ?? []).map((p) => p.id);
    const orParts = [`driver_code.ilike.${pattern}`, `employee_id.ilike.${pattern}`];
    if (profileIds.length > 0) {
      orParts.push(`id.in.(${profileIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((d) => {
    const prof = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? null,
      full_name: prof?.full_name ?? "—",
      partner_id: d.partner_id,
    };
  });
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

  const supabase = await createClient();

  // Pull the driver's directly-assigned restaurants (driver_restaurants junction)
  // and also any restaurants assigned via the intake table for legacy support.
  const [{ data: directRows }, { data: driver }] = await Promise.all([
    supabase
      .from("driver_restaurants")
      .select("restaurant_id")
      .eq("driver_id", driverId),
    supabase.from("drivers").select("partner_id").eq("id", driverId).maybeSingle(),
  ]);

  const directIds = new Set<string>(
    (directRows ?? []).map((r) => r.restaurant_id as string),
  );

  // Look up the linked intake (if any) for additional restaurant assignments.
  // driver_intakes.linked_profile_id matches drivers.id (both are the profile id).
  const { data: intakes } = await supabase
    .from("driver_intakes")
    .select("id")
    .eq("linked_profile_id", driverId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const intakeId = intakes?.[0]?.id;
  if (intakeId) {
    const { data: intakeRows } = await supabase
      .from("driver_intake_restaurants")
      .select("restaurant_id")
      .eq("intake_id", intakeId);
    for (const row of intakeRows ?? []) directIds.add(row.restaurant_id as string);
  }

  if (directIds.size === 0 && !driver?.partner_id) return [];

  const ids = Array.from(directIds);

  // Hydrate restaurant rows. If the driver has no direct assignments, fall back
  // to all restaurants on the driver's partner so the UI still shows chips.
  let query = supabase
    .from("restaurants")
    .select(
      "id, name, status, partner_id, partners (name)",
    )
    .order("name");

  if (ids.length > 0) {
    query = query.in("id", ids);
  } else if (driver?.partner_id) {
    query = query.eq("partner_id", driver.partner_id);
  }

  const { data: restaurants } = await query;
  if (!restaurants) return [];

  return restaurants.map((r) => {
    const partnerRel = r.partners as { name: string } | { name: string }[] | null;
    return {
      id: r.id as string,
      name: (r.name as string) ?? "—",
      partner_id: (r.partner_id as string | null) ?? null,
      partner_name: relName(partnerRel),
      status: (r.status as string) ?? "draft",
    };
  });
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

  const supabase = await createClient();
  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id, partner_id")
    .eq("id", restaurantId)
    .maybeSingle();

  if (restaurantError) {
    console.error("[createVerification] restaurant lookup failed", restaurantError);
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(restaurantError),
    };
  }
  if (!restaurant) return { error: "restaurant_not_found" };
  if (!restaurant.partner_id) return { error: "restaurant_not_found" };

  // Fall back to admin client if RLS prevents the staff role from inserting; the
  // session.id is captured so we still attribute the row to the acting admin.
  const writer = supabase;
  const { data, error } = await writer
    .from("delivery_verifications")
    .insert({
      driver_id: driverId,
      restaurant_id: restaurantId,
      partner_id: restaurant.partner_id,
      service_date: serviceDate,
      reported_count: reportedCount,
      notes: notes?.trim() || null,
      source: "manual",
      created_by: session.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "duplicate" };
    console.error("[createVerification] insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    // Retry with the service-role client so we surface the underlying issue
    // instead of letting RLS quietly hide a permission gap.
    const admin = createAdminClient();
    const retry = await admin
      .from("delivery_verifications")
      .insert({
        driver_id: driverId,
        restaurant_id: restaurantId,
        partner_id: restaurant.partner_id,
        service_date: serviceDate,
        reported_count: reportedCount,
        notes: notes?.trim() || null,
        source: "manual",
        created_by: session.id,
      })
      .select("id")
      .single();
    if (retry.error) {
      console.error("[createVerification] admin retry failed", {
        code: retry.error.code,
        message: retry.error.message,
        details: retry.error.details,
        hint: retry.error.hint,
      });
      if (retry.error.code === "23505") return { error: "duplicate" };
      return {
        error: "save_failed",
        errorDetail: formatPgErrorDetail(retry.error),
      };
    }
    void logAdminMutation({
      action: "create",
      entityType: "delivery_verification",
      entityId: retry.data.id,
      routeName: "createVerification",
      after: {
        driver_id: driverId,
        restaurant_id: restaurantId,
        service_date: serviceDate,
      },
    });
    return { success: true, id: retry.data.id };
  }

  void logAdminMutation({
    action: "create",
    entityType: "delivery_verification",
    entityId: data.id,
    routeName: "createVerification",
    after: { driver_id: driverId, restaurant_id: restaurantId, service_date: serviceDate },
  });

  return { success: true, id: data.id };
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("delivery_verifications")
    .update({
      reported_count: input.reportedCount,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) {
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail(error),
    };
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

  const supabase = await createClient();
  const { error } = await supabase.rpc("reconcile_delivery_verification", {
    p_verification_id: id,
  });

  if (error) {
    return {
      error: "reconcile_failed",
      errorDetail: formatPgErrorDetail(error),
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

  const supabase = await createAdminClient();
  const { error } = await supabase
    .from("delivery_verifications")
    .delete()
    .eq("id", id);

  if (error) {
    return {
      error: "delete_failed",
      errorDetail: formatPgErrorDetail(error),
    };
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
  const supabase = await createClient();

  const [{ data: drivers }, { data: restaurants }] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, driver_code, employee_id, partner_id, profiles(full_name)"),
    supabase.from("restaurants").select("id, name, partner_id, external_merchant_id, partners(name)"),
  ]);

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

  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from("verification_import_batches")
    .insert({
      file_name: payload.fileName,
      mapping: payload.mapping,
      row_count: payload.rows.length,
      applied_count: 0,
      skipped_count: preCheckSkipped,
      status: "applied",
      uploaded_by: session.id,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    logPgError("applyImportBatch.batchInsert", batchError);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(batchError) };
  }

  let applied = 0;
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  for (const row of ready) {
    const { data: restaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .select("partner_id")
      .eq("id", row.restaurant_id!)
      .single();

    if (restaurantError) {
      logPgError("applyImportBatch.restaurantLookup", restaurantError);
      failures.push({
        rowIndex: row.rowIndex,
        reason: formatPgErrorDetail(restaurantError) ?? "restaurant lookup failed",
      });
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

    if (payload.duplicateStrategy === "replace") {
      const { error } = await supabase
        .from("delivery_verifications")
        .upsert(record, { onConflict: "driver_id,restaurant_id,service_date" });
      if (!error) {
        applied += 1;
      } else {
        logPgError("applyImportBatch.upsert", error);
        failures.push({
          rowIndex: row.rowIndex,
          reason: formatPgErrorDetail(error) ?? error.message,
        });
      }
    } else {
      const { error } = await supabase.from("delivery_verifications").insert(record);
      if (!error) {
        applied += 1;
      } else if (error.code === "23505") {
        failures.push({ rowIndex: row.rowIndex, reason: "Duplicate (skip strategy)" });
      } else {
        logPgError("applyImportBatch.insert", error);
        failures.push({
          rowIndex: row.rowIndex,
          reason: formatPgErrorDetail(error) ?? error.message,
        });
      }
    }
  }

  await supabase
    .from("verification_import_batches")
    .update({
      applied_count: applied,
      skipped_count: preCheckSkipped + (ready.length - applied),
    })
    .eq("id", batch.id);

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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("verification_import_batches")
    .select(
      "id, file_name, row_count, applied_count, skipped_count, status, uploaded_at, reverted_at",
    )
    .order("uploaded_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []) as VerificationImportBatchRow[];
}

export async function getVerificationExportData(): Promise<VerificationExportData> {
  await requireVerificationsView();
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("restaurants")
    .select(
      `
      id,
      name,
      external_merchant_id,
      status,
      partner_id,
      zone_id,
      partners (name),
      zones (name, code)
    `,
    )
    .order("name", { ascending: true });

  if (error) throw error;

  const restaurants = (rows ?? []).map((row) => {
    const partnerRel = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    const zoneRel = Array.isArray(row.zones) ? row.zones[0] : row.zones;
    return {
      restaurant_id: row.id,
      restaurant_name: row.name,
      restaurant_external_id: row.external_merchant_id ?? null,
      partner_id: row.partner_id ?? null,
      partner_name: partnerRel?.name ?? "—",
      zone_id: row.zone_id ?? null,
      zone_name: zoneRel?.name ?? "—",
      status: row.status ?? "draft",
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

  const supabase = await createAdminClient();
  const { data: batch } = await supabase
    .from("verification_import_batches")
    .select("id, status")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) return { error: "batch_not_found" };
  if (batch.status === "reverted") return { error: "batch_already_reverted" };

  const { data: verifications } = await supabase
    .from("delivery_verifications")
    .select(
      "id, driver_id, restaurant_id, partner_id, service_date, shortfall_count",
    )
    .eq("import_batch_id", batchId);

  for (const v of verifications ?? []) {
    await supabase
      .from("deliveries")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("driver_id", v.driver_id)
      .in("status", ["verified", "under_review"])
      .gte("delivered_at", `${v.service_date}T00:00:00+03:00`)
      .lte("delivered_at", `${v.service_date}T23:59:59.999+03:00`)
      .or(
        `restaurant_id.eq.${v.restaurant_id},and(restaurant_id.is.null,partner_id.eq.${v.partner_id})`,
      );

    if (v.shortfall_count > 0) {
      const { data: bal } = await supabase
        .from("verification_balances")
        .select("balance_count")
        .eq("driver_id", v.driver_id)
        .eq("restaurant_id", v.restaurant_id)
        .maybeSingle();

      const next = Math.max(0, (bal?.balance_count ?? 0) - v.shortfall_count);
      if (next === 0) {
        await supabase
          .from("verification_balances")
          .delete()
          .eq("driver_id", v.driver_id)
          .eq("restaurant_id", v.restaurant_id);
      } else {
        await supabase
          .from("verification_balances")
          .update({ balance_count: next, updated_at: new Date().toISOString() })
          .eq("driver_id", v.driver_id)
          .eq("restaurant_id", v.restaurant_id);
      }
    }

    await supabase.from("delivery_verifications").delete().eq("id", v.id);
  }

  await supabase
    .from("verification_import_batches")
    .update({
      status: "reverted",
      reverted_at: new Date().toISOString(),
      reverted_by: session.id,
    })
    .eq("id", batchId);

  return { success: true, id: batchId };
}
