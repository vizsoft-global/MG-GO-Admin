"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  addDays,
  kuwaitToday,
  parsePerformanceWeights,
} from "./performance-formulas";
import {
  DEFAULT_PERFORMANCE_WEIGHTS,
  type PerformanceDriverRow,
  type PerformanceExceptionSummary,
  type PerformanceKpis,
  type PerformanceListFilters,
  type PerformanceListResult,
  type PerformanceScoreWeights,
  type RecentDeliveryFeedItem,
} from "./performance-types";

const DEFAULT_PAGE_SIZE = 50;

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireSettingsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    (!session.isSuperAdmin &&
      !hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin) &&
      !hasPermissionInSet(session.permissions, "attendance.manage", session.isSuperAdmin))
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function parseException(raw: unknown): PerformanceExceptionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    exception_type: String(o.exception_type ?? ""),
    exception_date: String(o.exception_date ?? ""),
    severity: String(o.severity ?? "medium"),
    resolution_status:
      o.resolution_status != null ? String(o.resolution_status) : null,
  };
}

function parseRow(raw: Record<string, unknown>): PerformanceDriverRow {
  const exceptionsRaw = Array.isArray(raw.exceptions) ? raw.exceptions : [];
  return {
    driver_id: String(raw.driver_id),
    driver_code: String(raw.driver_code ?? ""),
    employee_id: raw.employee_id != null ? String(raw.employee_id) : null,
    driver_name: String(raw.driver_name ?? "—"),
    driver_phone: String(raw.driver_phone ?? "—"),
    driver_status: String(raw.driver_status ?? ""),
    partner_id: raw.partner_id != null ? String(raw.partner_id) : null,
    partner_name: raw.partner_name != null ? String(raw.partner_name) : null,
    zone_id: raw.zone_id != null ? String(raw.zone_id) : null,
    zone_name: raw.zone_name != null ? String(raw.zone_name) : null,
    is_on_duty: Boolean(raw.is_on_duty),
    worked_days: Number(raw.worked_days ?? 0),
    leave_days: Number(raw.leave_days ?? 0),
    absent_days: Number(raw.absent_days ?? 0),
    eligible_days: Number(raw.eligible_days ?? 0),
    period_days: Number(raw.period_days ?? 0),
    actual_deliveries: Number(raw.actual_deliveries ?? 0),
    target_deliveries: Number(raw.target_deliveries ?? 0),
    rule_id: raw.rule_id != null ? String(raw.rule_id) : null,
    incentive_period:
      raw.incentive_period != null ? String(raw.incentive_period) : null,
    rule_target: Number(raw.rule_target ?? 0),
    delivery_efficiency: Number(raw.delivery_efficiency ?? 0),
    delivery_efficiency_raw: Number(raw.delivery_efficiency_raw ?? 0),
    utilization: Number(raw.utilization ?? 0),
    compliance_score: Number(raw.compliance_score ?? 0),
    exception_count: Number(raw.exception_count ?? 0),
    exceptions: exceptionsRaw
      .map(parseException)
      .filter((e): e is PerformanceExceptionSummary => e != null),
    overall_score: Number(raw.overall_score ?? 0),
  };
}

function parseKpis(raw: unknown): PerformanceKpis {
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (k: string) => {
    const v = o[k];
    if (v == null) return null;
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
  return {
    avg_overall: n("avg_overall"),
    avg_delivery_pct: n("avg_delivery_pct"),
    avg_utilization_pct: n("avg_utilization_pct"),
    avg_compliance: n("avg_compliance"),
    below_threshold: Number(o.below_threshold ?? 0),
  };
}

export async function fetchDriverPerformanceList(
  filters: PerformanceListFilters = {},
): Promise<PerformanceListResult> {
  await requireDriversView();
  const today = kuwaitToday();
  const from = filters.fromDate ?? addDays(today, -6);
  const to = filters.toDate ?? today;
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  void logAdminRead("performance", "fetchDriverPerformanceList", {
    from,
    to,
    filters,
  });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_driver_performance", {
    p_from: from,
    p_to: to,
    p_search: filters.search?.trim() || undefined,
    p_partner_id: filters.partnerId || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_restaurant_id: filters.restaurantId || undefined,
    p_driver_status:
      filters.driverStatus && filters.driverStatus !== "all"
        ? filters.driverStatus
        : undefined,
    p_driver_id: filters.driverId || undefined,
    p_sort: filters.sort ?? "overall_desc",
    p_limit: pageSize,
    p_offset: page * pageSize,
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];

  return {
    rows: rowsRaw.map((r) => parseRow(r as Record<string, unknown>)),
    totalCount: Number(payload.totalCount ?? 0),
    kpis: parseKpis(payload.kpis),
    weights: parsePerformanceWeights(payload.weights),
    from: String(payload.from ?? from),
    to: String(payload.to ?? to),
  };
}

export async function fetchDriverPerformanceDetail(
  driverId: string,
  fromDate: string,
  toDate: string,
): Promise<PerformanceDriverRow | null> {
  const result = await fetchDriverPerformanceList({
    driverId,
    fromDate,
    toDate,
    page: 0,
    pageSize: 1,
  });
  return result.rows[0] ?? null;
}

export async function getPerformanceScoreWeights(): Promise<PerformanceScoreWeights> {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      session.isSuperAdmin ||
      hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "attendance.manage", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin)
    )
  ) {
    throw new Error("not_authorized");
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("performance_score_weights")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return parsePerformanceWeights(
    data?.performance_score_weights ?? DEFAULT_PERFORMANCE_WEIGHTS,
  );
}

export async function updatePerformanceScoreWeights(
  weights: PerformanceScoreWeights,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSettingsManage();
    const next = parsePerformanceWeights(weights);
    const supabase = await createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({
        performance_score_weights: next,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      return { success: false, error: error.message };
    }

    void session;
    void logAdminMutation({
      action: "update",
      entityType: "app_settings",
      entityId: "1",
      routeName: "updatePerformanceScoreWeights",
      after: { weights: next },
      context: { weights: next },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "update_failed",
    };
  }
}

export async function fetchRecentDeliveriesFeed(
  limit = 30,
): Promise<RecentDeliveryFeedItem[]> {
  await requireDriversView();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deliveries")
    .select(
      `
      id,
      driver_id,
      status,
      delivered_at,
      created_at,
      drivers (driver_code, profiles (full_name)),
      partners (name),
      zones (name)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((r) => {
    const driver = Array.isArray(r.drivers) ? r.drivers[0] : r.drivers;
    const profile = driver
      ? Array.isArray(driver.profiles)
        ? driver.profiles[0]
        : driver.profiles
      : null;
    const partner = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    const zone = Array.isArray(r.zones) ? r.zones[0] : r.zones;
    return {
      id: String(r.id),
      driver_id: r.driver_id != null ? String(r.driver_id) : null,
      driver_name: String(profile?.full_name ?? "—"),
      driver_code: String(driver?.driver_code ?? ""),
      status: String(r.status),
      partner_name: partner?.name != null ? String(partner.name) : null,
      zone_name: zone?.name != null ? String(zone.name) : null,
      delivered_at: r.delivered_at != null ? String(r.delivered_at) : null,
      created_at: String(r.created_at),
    };
  });
}
