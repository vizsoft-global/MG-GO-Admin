"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  addDays,
  kuwaitToday,
  parsePerformanceWeights,
  ratingPeriodMonth,
} from "./performance-formulas";
import {
  DEFAULT_PERFORMANCE_WEIGHTS,
  performanceBand,
  PERFORMANCE_COMPONENT_KEYS,
  type PerformanceComponent,
  type PerformanceComponentKey,
  type PerformanceComponentScores,
  type PerformanceComponentSettings,
  type PerformanceDailyResult,
  type DpdLiveBreakdownRow,
  type DpdLiveLeaderRow,
  type DpdLiveSnapshot,
  type PerformanceDriverRow,
  type PerformanceExceptionSummary,
  type PerformanceKpis,
  type PerformanceListFilters,
  type PerformanceListResult,
  type PerformanceManualTeamScore,
  type PerformanceRatingCriterion,
  type PerformanceRatingPanel,
  type PerformanceRatingTeamConfig,
  type PerformanceRatingTeamRow,
  type PerformanceReport,
  type PerformanceReportCriterion,
  type PerformanceReportTeam,
  type PerformanceScoreWeights,
  type PerformanceBandCounts,
  type PerformanceBandMigration,
  type PerformanceTrend,
  type PerformanceTrendBucket,
  type PerformanceTrendGroup,
  type PerformanceTrendTotals,
  type RecentDeliveryFeedItem,
  type DpdEfficiencyGroup,
  type DpdEfficiencyRider,
  type DpdEfficiencySnapshot,
} from "./performance-types";
import { asInt, asStr, isoDate, numOrNull } from "./performance-ops-format";
import type {
  OpsBounds,
  OpsDimRow,
  OpsKpis,
  OpsOptions,
  OpsQueryInput,
  OpsRiderRow,
  OpsSnapshot,
  OpsStoreRow,
  OpsTrendPoint,
  TargetDpdRow,
} from "./performance-ops-types";

const DEFAULT_PAGE_SIZE = 50;

/** Matches the server cap in admin_list_driver_performance. */
const MAX_EXPORT_ROWS = 2000;

async function requirePerformanceView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "performance.view",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requirePerformanceExport() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "performance.export",
      session.isSuperAdmin,
    )
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

function parseManualTeams(raw: unknown): PerformanceManualTeamScore[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      team_key: String(o.team_key ?? ""),
      score: Number(o.score ?? 0),
      months_rated: Number(o.months_rated ?? 0),
      last_rated_at: o.last_rated_at == null ? null : String(o.last_rated_at),
    };
  });
}

const COMPONENT_KEY_SET = new Set<string>(PERFORMANCE_COMPONENT_KEYS);

/**
 * Absent stays absent. A key the server did not send is a component with no data
 * for the period, and coalescing it to 0 here would undo the whole point of the
 * blend renormalising around it.
 */
function parseComponentScores(raw: unknown): PerformanceComponentScores {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: PerformanceComponentScores = {};
  for (const [key, value] of Object.entries(source)) {
    if (!COMPONENT_KEY_SET.has(key) || value == null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key as PerformanceComponentKey] = n;
  }
  return out;
}

function parseComponents(raw: unknown): PerformanceComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      const o = (entry ?? {}) as Record<string, unknown>;
      const key = String(o.key ?? "");
      if (!COMPONENT_KEY_SET.has(key)) return null;
      return {
        key: key as PerformanceComponentKey,
        label_en: String(o.label_en ?? key),
        label_ar: String(o.label_ar ?? key),
        weight: Number(o.weight ?? 1),
        sort_order: Number(o.sort_order ?? index),
        is_active: o.is_active == null ? true : Boolean(o.is_active),
      };
    })
    .filter((c): c is PerformanceComponent => c != null);
}

/** `team_key.criterion_key` -> the 1-5 average a rater actually picked. */
function parseManualCriteria(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
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
    restaurant_name:
      raw.restaurant_name != null ? String(raw.restaurant_name) : null,
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
    compliance_score:
      raw.compliance_score == null ||
      !Number.isFinite(Number(raw.compliance_score))
        ? null
        : Number(raw.compliance_score),
    legacy_compliance_score:
      raw.legacy_compliance_score == null ||
      !Number.isFinite(Number(raw.legacy_compliance_score))
        ? null
        : Number(raw.legacy_compliance_score),
    component_scores: parseComponentScores(raw.component_scores),
    exception_count: Number(raw.exception_count ?? 0),
    penalised_exception_count: Number(raw.penalised_exception_count ?? 0),
    exceptions: exceptionsRaw
      .map(parseException)
      .filter((e): e is PerformanceExceptionSummary => e != null),
    manual_score:
      raw.manual_score == null || !Number.isFinite(Number(raw.manual_score))
        ? null
        : Number(raw.manual_score),
    manual_rating_count: Number(raw.manual_rating_count ?? 0),
    manual_teams: parseManualTeams(raw.manual_teams),
    manual_criteria: parseManualCriteria(raw.manual_criteria),
    overall_score: Number(raw.overall_score ?? 0),
    dpd_rank: Number(raw.dpd_rank ?? 0),
    score_band:
      raw.score_band === "top" ||
      raw.score_band === "good" ||
      raw.score_band === "watch" ||
      raw.score_band === "critical"
        ? raw.score_band
        : performanceBand(Number(raw.overall_score ?? 0)),
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
  const s = (k: string) => {
    const v = o[k];
    return v == null || String(v).trim() === "" ? null : String(v);
  };
  return {
    avg_overall: n("avg_overall"),
    avg_delivery_pct: n("avg_delivery_pct"),
    avg_utilization_pct: n("avg_utilization_pct"),
    avg_compliance: n("avg_compliance"),
    avg_legacy_compliance: n("avg_legacy_compliance"),
    below_threshold: Number(o.below_threshold ?? 0),
    top_score: n("top_score"),
    bottom_score: n("bottom_score"),
    top_driver_name: s("top_driver_name"),
    bottom_driver_name: s("bottom_driver_name"),
    band_top: Number(o.band_top ?? 0),
    band_good: Number(o.band_good ?? 0),
    band_watch: Number(o.band_watch ?? 0),
    band_critical: Number(o.band_critical ?? 0),
    avg_manual: n("avg_manual"),
    rated_drivers: Number(o.rated_drivers ?? 0),
  };
}

async function loadDriverRestaurantNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (driverIds.length === 0) return names;
  const { data } = await supabase
    .from("driver_restaurants")
    .select("driver_id, restaurants(name)")
    .in("driver_id", driverIds);
  const buckets = new Map<string, string[]>();
  for (const row of data ?? []) {
    const restaurant = Array.isArray(row.restaurants)
      ? row.restaurants[0]
      : row.restaurants;
    const name =
      restaurant && typeof restaurant === "object" && "name" in restaurant
        ? String((restaurant as { name?: string }).name ?? "").trim()
        : "";
    if (!name) continue;
    const list = buckets.get(row.driver_id) ?? [];
    if (!list.includes(name)) list.push(name);
    buckets.set(row.driver_id, list);
  }
  for (const [id, list] of buckets) {
    names.set(id, list.join(", "));
  }
  return names;
}

/** Ungated read. Every caller must have gated on its own permission first. */
async function runPerformanceList(
  filters: PerformanceListFilters,
): Promise<PerformanceListResult> {
  const today = kuwaitToday();
  const from = filters.fromDate ?? addDays(today, -6);
  const to = filters.toDate ?? today;
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const supabase = await createClient();
  // RPC present in prod; regenerate database.ts when CLI types catch up.
  const { data, error } = await supabase.rpc(
    "admin_list_driver_performance" as never,
    {
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
    } as never,
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw.map((r) => parseRow(r as Record<string, unknown>));
  const restaurantNames = await loadDriverRestaurantNames(
    supabase,
    rows.map((r) => r.driver_id),
  );

  return {
    rows: rows.map((row) => ({
      ...row,
      restaurant_name: restaurantNames.get(row.driver_id) ?? row.restaurant_name,
    })),
    totalCount: Number(payload.totalCount ?? 0),
    kpis: parseKpis(payload.kpis),
    weights: parsePerformanceWeights(payload.weights),
    components: parseComponents(payload.components),
    criteria: parseCriteria(payload.criteria),
    slaMinutes: Number(payload.slaMinutes ?? 45),
    from: String(payload.from ?? from),
    to: String(payload.to ?? to),
    maxExportRows: Number(payload.maxExportRows ?? MAX_EXPORT_ROWS),
  };
}

export async function fetchDriverPerformanceList(
  filters: PerformanceListFilters = {},
): Promise<PerformanceListResult> {
  await requirePerformanceView();

  void logAdminRead("performance", "fetchDriverPerformanceList", {
    from: filters.fromDate,
    to: filters.toDate,
    filters,
  });

  return runPerformanceList(filters);
}

function parseDpdRider(raw: unknown): DpdEfficiencyRider | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => {
    const v = o[k];
    if (v == null) return null;
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
  const s = (k: string) => {
    const v = o[k];
    return v == null || String(v).trim() === "" ? null : String(v);
  };
  const driverId = s("driver_id");
  if (!driverId) return null;
  return {
    driver_id: driverId,
    driver_name: String(o.driver_name ?? "—"),
    employee_id: s("employee_id"),
    driver_code: String(o.driver_code ?? ""),
    restaurant_id: s("restaurant_id"),
    restaurant_name: s("restaurant_name"),
    zone_id: s("zone_id"),
    zone_name: s("zone_name"),
    actual: Number(o.actual ?? 0),
    target: n("target"),
    efficiency: n("efficiency"),
    dpd_rider: n("dpd_rider"),
    worked_days: Number(o.worked_days ?? 0),
  };
}

function parseDpdGroup(raw: unknown): DpdEfficiencyGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => {
    const v = o[k];
    if (v == null) return null;
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
  const s = (k: string) => {
    const v = o[k];
    return v == null || String(v).trim() === "" ? null : String(v);
  };
  return {
    id: s("id"),
    name: s("name"),
    zone_id: s("zone_id"),
    zone_name: s("zone_name"),
    restaurant_id: s("restaurant_id"),
    restaurant_name: s("restaurant_name"),
    actual: Number(o.actual ?? 0),
    target: n("target"),
    efficiency: n("efficiency"),
    riders: Number(o.riders ?? 0),
  };
}

export async function fetchDpdEfficiencySnapshot(input: {
  from: string;
  to: string;
  restaurantId?: string;
  zoneId?: string;
  partnerId?: string;
}): Promise<DpdEfficiencySnapshot> {
  await requirePerformanceView();
  const from = input.from.slice(0, 10);
  const to = input.to.slice(0, 10);
  if (!from || !to || to < from) {
    throw new Error("invalid_date_range");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_dpd_efficiency_snapshot" as never,
    {
      p_from: from,
      p_to: to,
      p_restaurant_id: input.restaurantId || undefined,
      p_zone_id: input.zoneId || undefined,
      p_partner_id: input.partnerId || undefined,
    } as never,
  );
  if (error) throw new Error(error.message);

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = (key: string, parse: (raw: unknown) => DpdEfficiencyRider | null) =>
    (Array.isArray(payload[key]) ? payload[key] : [])
      .map(parse)
      .filter((row): row is DpdEfficiencyRider => row != null);
  const groups = (key: string) =>
    (Array.isArray(payload[key]) ? payload[key] : [])
      .map(parseDpdGroup)
      .filter((row): row is DpdEfficiencyGroup => row != null);

  void logAdminRead("performance", "fetchDpdEfficiencySnapshot", {
    from,
    to,
    restaurantId: input.restaurantId,
    zoneId: input.zoneId,
  });

  return {
    from: String(payload.from ?? from),
    to: String(payload.to ?? to),
    riders: list("riders", parseDpdRider),
    restaurants: groups("restaurants"),
    zones: groups("zones"),
    zone_restaurants: groups("zone_restaurants"),
    top10: list("top10", parseDpdRider),
    bottom10: list("bottom10", parseDpdRider),
  };
}

/**
 * One unpaged read for the Excel report. Always ranked highest to lowest,
 * whatever the operator has the table sorted by — the report is the ranking.
 */
export async function fetchDriverPerformanceReport(input: {
  from: string;
  to: string;
  filters?: Omit<
    PerformanceListFilters,
    "page" | "pageSize" | "sort" | "fromDate" | "toDate"
  >;
}): Promise<PerformanceReport> {
  await requirePerformanceExport();

  const from = input.from?.slice(0, 10) ?? "";
  const to = input.to?.slice(0, 10) ?? "";
  if (!from || !to || to < from) {
    throw new Error("invalid_date_range");
  }

  const result = await runPerformanceList({
    ...(input.filters ?? {}),
    fromDate: from,
    toDate: to,
    sort: "overall_desc",
    page: 0,
    pageSize: MAX_EXPORT_ROWS,
  });

  void logAdminRead("performance_report", "fetchDriverPerformanceReport", {
    from,
    to,
    rowCount: result.rows.length,
  });

  return {
    from: result.from,
    to: result.to,
    rows: result.rows,
    kpis: result.kpis,
    weights: result.weights,
    ratingTeams: await reportRatingTeams(),
    components: await reportComponents(result.components),
    criteria: result.criteria,
    totalCount: result.totalCount,
    truncated: result.totalCount > result.rows.length,
  };
}

/**
 * Columns come from the component table, not from the list RPC catalog. The
 * list drops inactive / zero-weight keys so they would never appear in the
 * sheet even when component_scores still holds the values.
 */
async function reportComponents(
  fallback: PerformanceComponent[],
): Promise<PerformanceComponent[]> {
  try {
    const catalog = await loadPerformanceComponentCatalog();
    return catalog.length > 0 ? catalog : fallback;
  } catch {
    return fallback;
  }
}

async function loadPerformanceComponentCatalog(): Promise<
  PerformanceComponent[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_list_performance_components" as never,
  );
  if (error) return [];
  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return parseComponents(payload.components);
}

/**
 * Team columns come from the team table rather than from the rows, so the
 * workbook's shape does not change with who happened to be rated. A failure
 * here yields no team columns instead of no report.
 */
async function reportRatingTeams(): Promise<PerformanceReportTeam[]> {
  try {
    const teams = await fetchPerformanceRatingTeams();
    return teams
      .filter((team) => team.is_active)
      .map((team) => ({ key: team.key, label: team.label_en }));
  } catch {
    return [];
  }
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseBreakdown(raw: unknown): DpdLiveBreakdownRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      id: o.id == null ? null : String(o.id),
      label:
        o.label == null || String(o.label).trim() === ""
          ? null
          : String(o.label),
      deliveries: num(o.deliveries),
      on_duty: num(o.on_duty),
    };
  });
}

function parseLeaderboard(raw: unknown): DpdLiveLeaderRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      driver_id: String(o.driver_id ?? ""),
      driver_name: String(o.driver_name ?? "—"),
      driver_code: String(o.driver_code ?? ""),
      zone_name: o.zone_name == null ? null : String(o.zone_name),
      partner_name: o.partner_name == null ? null : String(o.partner_name),
      is_on_duty: Boolean(o.is_on_duty),
      submitted: num(o.submitted),
      verified: num(o.verified),
      in_transit: num(o.in_transit),
    };
  });
}

/** One round trip for the live DPD tab — see admin_dpd_live_snapshot. */
export async function fetchDpdLiveSnapshot(
  date?: string,
): Promise<DpdLiveSnapshot> {
  await requirePerformanceView();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dpd_live_snapshot", {
    p_date: date ?? undefined,
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const deliveries = (payload.deliveries ?? {}) as Record<string, unknown>;
  const roster = (payload.roster ?? {}) as Record<string, unknown>;
  const alerts = (payload.alerts ?? {}) as Record<string, unknown>;

  return {
    date: String(payload.date ?? date ?? kuwaitToday()),
    generated_at: String(payload.generated_at ?? new Date().toISOString()),
    deliveries: {
      created: num(deliveries.created),
      in_transit: num(deliveries.in_transit),
      pending: num(deliveries.pending),
      under_review: num(deliveries.under_review),
      verified: num(deliveries.verified),
      rejected: num(deliveries.rejected),
      cancelled: num(deliveries.cancelled),
    },
    roster: {
      active_drivers: num(roster.active_drivers),
      total_drivers: num(roster.total_drivers),
      on_duty: num(roster.on_duty),
      tracking_live: num(roster.tracking_live),
      checked_in: num(roster.checked_in),
    },
    alerts: {
      out_of_zone: num(alerts.out_of_zone),
      gps_offline: num(alerts.gps_offline),
      low_battery: num(alerts.low_battery),
    },
    leaderboard: parseLeaderboard(payload.leaderboard),
    zones: parseBreakdown(payload.zones),
    partners: parseBreakdown(payload.partners),
    score: parseKpis(payload.score),
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
      hasPermissionInSet(session.permissions, "performance.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "attendance.manage", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin)
    )
  ) {
    throw new Error("not_authorized");
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const weights = (data as { performance_score_weights?: unknown } | null)
    ?.performance_score_weights;
  return parsePerformanceWeights(weights ?? DEFAULT_PERFORMANCE_WEIGHTS);
}

export async function updatePerformanceScoreWeights(
  weights: PerformanceScoreWeights,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSettingsManage();
    const next = parsePerformanceWeights(weights);
    const supabase = await createClient();

    // One save re-scores the whole fleet, so the entry has to say what it was
    // before. A read here can race a concurrent save; that is acceptable for
    // weights, which are edited by one operator on one settings page, and the
    // alternative is another RPC for a field the panel already owns.
    const previous = await getPerformanceScoreWeights().catch(() => null);

    const { error } = await supabase
      .from("app_settings")
      .update({
        performance_score_weights: next,
        updated_at: new Date().toISOString(),
      } as never)
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
      before: previous ? { weights: previous } : null,
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

/**
 * One driver's standing in the whole fleet, for their detail page.
 *
 * It has to be read from the *unfiltered* list, because `dpd_rank` is computed
 * over whatever population the filters leave: asking for one driver would return
 * rank 1 out of 1 for everybody, which is a number that looks right and means
 * nothing. The fleet-wide read happens here rather than in the browser so the
 * page pays for a rank, not for two thousand rows it would throw away.
 *
 * Above the cap the rank is returned as null instead of a wrong one — a driver
 * ranked against a truncated fleet is the same lie in a smaller size.
 */
export async function fetchDriverPerformanceRank(
  driverId: string,
  fromDate: string,
  toDate: string,
): Promise<{ rank: number | null; total: number; band: string | null }> {
  await requirePerformanceView();

  const result = await runPerformanceList({
    fromDate,
    toDate,
    sort: "overall_desc",
    page: 0,
    pageSize: MAX_EXPORT_ROWS,
  });

  if (result.totalCount > result.rows.length) {
    return { rank: null, total: result.totalCount, band: null };
  }

  const row = result.rows.find((entry) => entry.driver_id === driverId);
  return {
    rank: row?.dpd_rank ?? null,
    total: result.totalCount,
    band: row?.score_band ?? null,
  };
}

/**
 * The per-day breakdown behind the compliance column.
 *
 * Gated on attendance.view as well as performance.view, because the surface it
 * feeds is the Attendance page: requiring the performance permission there would
 * hide the explanation from exactly the operator whose column it explains.
 */
export async function fetchDriverPerformanceDaily(
  driverId: string,
  from: string,
  to: string,
): Promise<PerformanceDailyResult> {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      session.isSuperAdmin ||
      hasPermissionInSet(session.permissions, "performance.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin)
    )
  ) {
    throw new Error("not_authorized");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_driver_performance_daily" as never,
    { p_driver_id: driverId, p_from: from, p_to: to } as never,
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];

  return {
    rows: rowsRaw.map((entry) => {
      const o = (entry ?? {}) as Record<string, unknown>;
      const n = (key: string) => {
        const v = o[key];
        if (v == null) return null;
        const num = Number(v);
        return Number.isFinite(num) ? num : null;
      };
      return {
        log_date: String(o.log_date ?? ""),
        worked: Boolean(o.worked),
        on_leave: Boolean(o.on_leave),
        absent: Boolean(o.absent),
        compliance_score: n("compliance_score"),
        component_scores: parseComponentScores(o.component_scores),
        deliveries_completed: n("deliveries_completed"),
        deliveries_within_sla: n("deliveries_within_sla"),
        overspeed_events: n("overspeed_events"),
        sources_complete: Array.isArray(o.sources_complete)
          ? o.sources_complete.map(String)
          : [],
      };
    }),
    components: parseComponents(payload.components),
    from: String(payload.from ?? from),
    to: String(payload.to ?? to),
  };
}

/**
 * The whole analysis tab in one round trip — see admin_performance_trend.
 *
 * The comparison half comes back from the same call rather than from a second
 * fetch with shifted dates: two calls could straddle a rollup and produce a
 * delta between a window read before it and one read after.
 */
export async function fetchPerformanceTrend(input: {
  fromDate: string;
  toDate: string;
  bucket?: PerformanceTrendBucket;
  zoneId?: string;
  partnerId?: string;
}): Promise<PerformanceTrend> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "performance.analyze",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_performance_trend" as never,
    {
      p_from: input.fromDate,
      p_to: input.toDate,
      p_bucket: input.bucket ?? "day",
      p_zone_id: input.zoneId || null,
      p_partner_id: input.partnerId || null,
    } as never,
  );

  if (error) {
    throw new Error(error.message);
  }

  void logAdminRead("performance_trend", "/performance", {
    from: input.fromDate,
    to: input.toDate,
    bucket: input.bucket ?? "day",
  });

  return parsePerformanceTrend(data, input);
}

function parsePerformanceTrend(
  data: unknown,
  input: { fromDate: string; toDate: string; bucket?: PerformanceTrendBucket },
): PerformanceTrend {
  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  return {
    from: String(payload.from ?? input.fromDate),
    to: String(payload.to ?? input.toDate),
    previous_from: String(payload.previous_from ?? ""),
    previous_to: String(payload.previous_to ?? ""),
    bucket: parseTrendBucket(payload.bucket) ?? input.bucket ?? "day",
    components: parseComponents(payload.components),
    series: (Array.isArray(payload.series) ? payload.series : []).map((entry) => {
      const o = (entry ?? {}) as Record<string, unknown>;
      return {
        bucket: String(o.bucket ?? ""),
        score: nullableNumber(o.score),
        drivers: countOf(o.drivers),
        worked_days: countOf(o.worked_days),
        leave_days: countOf(o.leave_days),
        absent_days: countOf(o.absent_days),
        deliveries: countOf(o.deliveries),
        within_sla: countOf(o.within_sla),
        components: parseComponentScores(o.components),
      };
    }),
    totals: parseTrendTotals(payload.totals),
    previous_totals: parseTrendTotals(payload.previous_totals),
    by_zone: parseTrendGroups(payload.by_zone),
    by_partner: parseTrendGroups(payload.by_partner),
    by_team: parseTrendGroups(payload.by_team),
    bands: parseBandMigration(payload.bands),
  };
}

function parseTrendBucket(value: unknown): PerformanceTrendBucket | null {
  return value === "day" || value === "week" || value === "month" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTrendTotals(value: unknown): PerformanceTrendTotals {
  const o = (value ?? {}) as Record<string, unknown>;
  const measured = Array.isArray(o.components_measured)
    ? o.components_measured
        .map(String)
        .filter((k): k is PerformanceComponentKey =>
          (PERFORMANCE_COMPONENT_KEYS as readonly string[]).includes(k),
        )
    : [];
  return {
    score: nullableNumber(o.score),
    drivers: countOf(o.drivers),
    worked_days: countOf(o.worked_days),
    leave_days: countOf(o.leave_days),
    absent_days: countOf(o.absent_days),
    deliveries: countOf(o.deliveries),
    within_sla: countOf(o.within_sla),
    sla_rate: nullableNumber(o.sla_rate),
    overspeed_events: countOf(o.overspeed_events),
    conduct_weighted: countOf(o.conduct_weighted),
    components_measured: measured,
  };
}

function parseTrendGroups(value: unknown): PerformanceTrendGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      key: o.key == null ? null : String(o.key),
      label: String(o.label ?? ""),
      score: nullableNumber(o.score),
      drivers: countOf(o.drivers),
      deliveries: o.deliveries == null ? undefined : countOf(o.deliveries),
      avg_rating: o.avg_rating == null ? null : nullableNumber(o.avg_rating),
    };
  });
}

function parseBandCounts(value: unknown): PerformanceBandCounts {
  const o = (value ?? {}) as Record<string, unknown>;
  return {
    top: countOf(o.top),
    good: countOf(o.good),
    watch: countOf(o.watch),
    critical: countOf(o.critical),
  };
}

function parseBandMigration(value: unknown): PerformanceBandMigration {
  const o = (value ?? {}) as Record<string, unknown>;
  return {
    improved: countOf(o.improved),
    declined: countOf(o.declined),
    unchanged: countOf(o.unchanged),
    current: parseBandCounts(o.current),
    previous: parseBandCounts(o.previous),
  };
}

export async function fetchPerformanceComponents(): Promise<{
  components: PerformanceComponent[];
  settings: PerformanceComponentSettings;
}> {
  await requirePerformanceView();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "admin_list_performance_components" as never,
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const settings = (payload.settings ?? {}) as Record<string, unknown>;

  return {
    components: parseComponents(payload.components),
    settings: {
      delivery_ontime_minutes: Number(settings.delivery_ontime_minutes ?? 45),
      speed_allowance_per_day: Number(settings.speed_allowance_per_day ?? 2),
      conduct_allowance_per_day: Number(settings.conduct_allowance_per_day ?? 0.25),
    },
  };
}

/**
 * One save re-scores the entire fleet, so the previous and new values are both
 * recorded. The RPC returns both from inside the same statement rather than the
 * caller reading before and after, which could race another admin's save.
 */
export async function updatePerformanceComponents(input: {
  components: { key: string; weight?: number; is_active?: boolean }[];
  settings?: Partial<PerformanceComponentSettings>;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSettingsManage();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "admin_update_performance_components" as never,
      {
        p_components: input.components,
        p_settings: input.settings ?? null,
      } as never,
    );

    if (error) {
      return { success: false, error: error.message };
    }

    const result =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};

    void logAdminMutation({
      action: "update",
      entityType: "performance_score_components",
      entityId: "all",
      routeName: "updatePerformanceComponents",
      before: (result.before ?? null) as Record<string, unknown> | null,
      after: (result.after ?? null) as Record<string, unknown> | null,
      context: { settings: input.settings ?? null },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "update_failed",
    };
  }
}

function nullableNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRatingCriterion(raw: unknown): PerformanceRatingCriterion {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    criterion_id: String(o.criterion_id ?? ""),
    key: String(o.key ?? ""),
    label_en: String(o.label_en ?? ""),
    label_ar: String(o.label_ar ?? ""),
    weight: num(o.weight ?? 1),
    score: nullableNum(o.score),
    rated_at: o.rated_at == null ? null : String(o.rated_at),
  };
}

function parseRatingTeamRow(raw: unknown): PerformanceRatingTeamRow {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    team_key: String(o.team_key ?? ""),
    label_en: String(o.label_en ?? ""),
    label_ar: String(o.label_ar ?? ""),
    weight: num(o.weight ?? 1),
    score: nullableNum(o.score),
    comment: o.comment == null ? null : String(o.comment),
    comment_at: o.comment_at == null ? null : String(o.comment_at),
    comment_by_name:
      o.comment_by_name == null ? null : String(o.comment_by_name),
    rated_at: o.rated_at == null ? null : String(o.rated_at),
    rated_by_name: o.rated_by_name == null ? null : String(o.rated_by_name),
    can_edit: Boolean(o.can_edit),
    criteria: Array.isArray(o.criteria)
      ? o.criteria.map(parseRatingCriterion)
      : [],
  };
}

function parseCriteria(raw: unknown): PerformanceReportCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? ""),
      team_key: String(o.team_key ?? ""),
      key: String(o.key ?? ""),
      label_en: String(o.label_en ?? ""),
      label_ar: String(o.label_ar ?? ""),
      team_label_en: String(o.team_label_en ?? o.team_key ?? ""),
      team_label_ar: String(o.team_label_ar ?? o.team_key ?? ""),
    };
  });
}

export async function fetchDriverPerformanceRatings(
  driverId: string,
  periodMonth?: string,
): Promise<PerformanceRatingPanel> {
  await requirePerformanceView();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "admin_list_driver_performance_ratings",
    {
      p_driver_id: driverId,
      p_period_month: periodMonth ?? ratingPeriodMonth(kuwaitToday()),
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const teams = Array.isArray(payload.teams) ? payload.teams : [];

  return {
    driver_id: String(payload.driver_id ?? driverId),
    period_month: String(
      payload.period_month ?? periodMonth ?? ratingPeriodMonth(kuwaitToday()),
    ),
    teams: teams.map(parseRatingTeamRow),
  };
}

async function requireRatePermission() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "performance.rate",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
}

export async function saveDriverPerformanceRating(input: {
  driverId: string;
  criterionId: string;
  periodMonth: string;
  score: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRatePermission();

    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "admin_upsert_driver_performance_rating",
      {
        p_driver_id: input.driverId,
        p_criterion_id: input.criterionId,
        p_period_month: input.periodMonth,
        p_score: input.score,
      },
    );

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: "update",
      entityType: "driver_performance_rating",
      entityId: `${input.driverId}:${input.criterionId}:${input.periodMonth}`,
      routeName: "saveDriverPerformanceRating",
      after: { score: input.score },
      context: { criterion: input.criterionId, period: input.periodMonth },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "save_failed",
    };
  }
}

export async function clearDriverPerformanceRating(input: {
  driverId: string;
  criterionId: string;
  periodMonth: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRatePermission();

    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "admin_delete_driver_performance_rating",
      {
        p_driver_id: input.driverId,
        p_criterion_id: input.criterionId,
        p_period_month: input.periodMonth,
      },
    );

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: "delete",
      entityType: "driver_performance_rating",
      entityId: `${input.driverId}:${input.criterionId}:${input.periodMonth}`,
      routeName: "clearDriverPerformanceRating",
      context: { criterion: input.criterionId, period: input.periodMonth },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "delete_failed",
    };
  }
}

/**
 * One note per team per month. Kept off the score path so a rater can adjust a
 * star without retyping the paragraph, and vice versa.
 */
export async function saveDriverPerformanceRatingNote(input: {
  driverId: string;
  teamKey: string;
  periodMonth: string;
  comment: string | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireRatePermission();

    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "admin_set_driver_performance_rating_note",
      {
        p_driver_id: input.driverId,
        p_team_key: input.teamKey,
        p_period_month: input.periodMonth,
        p_comment: input.comment ?? "",
      },
    );

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: "update",
      entityType: "driver_performance_rating_note",
      entityId: `${input.driverId}:${input.teamKey}:${input.periodMonth}`,
      routeName: "saveDriverPerformanceRatingNote",
      context: { team: input.teamKey, period: input.periodMonth },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "save_failed",
    };
  }
}

export async function fetchPerformanceRatingTeams(): Promise<
  PerformanceRatingTeamConfig[]
> {
  await requirePerformanceView();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "admin_list_performance_rating_teams",
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const teams = Array.isArray(payload.teams) ? payload.teams : [];

  return teams.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    const members = Array.isArray(o.members) ? o.members : [];
    const criteria = Array.isArray(o.criteria) ? o.criteria : [];
    const teamKey = String(o.key ?? "");
    return {
      key: teamKey,
      label_en: String(o.label_en ?? ""),
      label_ar: String(o.label_ar ?? ""),
      weight: num(o.weight ?? 1),
      sort_order: num(o.sort_order),
      is_active: Boolean(o.is_active),
      members: members.map((m) => {
        const mo = (m ?? {}) as Record<string, unknown>;
        return {
          profile_id: String(mo.profile_id ?? ""),
          full_name: String(mo.full_name ?? "—"),
          email: mo.email == null ? null : String(mo.email),
        };
      }),
      criteria: criteria.map((c) => {
        const co = (c ?? {}) as Record<string, unknown>;
        return {
          id: String(co.id ?? ""),
          team_key: String(co.team_key ?? teamKey),
          key: String(co.key ?? ""),
          label_en: String(co.label_en ?? ""),
          label_ar: String(co.label_ar ?? ""),
          weight: num(co.weight ?? 1),
          sort_order: num(co.sort_order),
          is_active: Boolean(co.is_active),
          rating_count: num(co.rating_count),
        };
      }),
    };
  });
}

async function requireManageTeams() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "performance.manage_teams",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
}

export async function savePerformanceRatingCriterion(input: {
  id?: string | null;
  teamKey: string;
  key?: string | null;
  labelEn: string;
  labelAr: string;
  weight: number;
  sortOrder: number;
  isActive: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireManageTeams();

    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "admin_upsert_performance_rating_criterion",
      {
        // Null, not omitted: a null p_id is what tells the RPC this is an
        // insert, so the parameter has to arrive.
        p_id: input.id ?? null,
        p_team_key: input.teamKey,
        p_key: input.key ?? null,
        p_label_en: input.labelEn,
        p_label_ar: input.labelAr,
        p_weight: input.weight,
        p_sort_order: input.sortOrder,
        p_is_active: input.isActive,
      } as never,
    );

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: input.id ? "update" : "create",
      entityType: "performance_rating_criterion",
      entityId: input.id ?? `${input.teamKey}:${input.key ?? input.labelEn}`,
      routeName: "savePerformanceRatingCriterion",
      after: {
        team_key: input.teamKey,
        label_en: input.labelEn,
        label_ar: input.labelAr,
        weight: input.weight,
        sort_order: input.sortOrder,
        is_active: input.isActive,
      },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "save_failed",
    };
  }
}

export async function deletePerformanceRatingCriterion(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireManageTeams();

    const supabase = await createClient();
    const { error } = await supabase.rpc(
      "admin_delete_performance_rating_criterion",
      { p_id: id },
    );

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: "delete",
      entityType: "performance_rating_criterion",
      entityId: id,
      routeName: "deletePerformanceRatingCriterion",
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "delete_failed",
    };
  }
}

export async function setPerformanceTeamMember(input: {
  teamKey: string;
  profileId: string;
  member: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getSessionUser();
    if (
      !session ||
      !hasPermissionInSet(
        session.permissions,
        "performance.manage_teams",
        session.isSuperAdmin,
      )
    ) {
      throw new Error("not_authorized");
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_performance_team_member", {
      p_team_key: input.teamKey,
      p_profile_id: input.profileId,
      p_member: input.member,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    void logAdminMutation({
      action: input.member ? "create" : "delete",
      entityType: "performance_rating_team_member",
      entityId: `${input.teamKey}:${input.profileId}`,
      routeName: "setPerformanceTeamMember",
      context: { team: input.teamKey, member: input.member },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "update_failed",
    };
  }
}

/** Panel staff eligible to sit on a rating team. */
export async function fetchRatingEligibleStaff(): Promise<
  { id: string; full_name: string; email: string | null }[]
> {
  await requirePerformanceView();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "staff")
    .eq("approval_status", "approved")
    .not("admin_role_id", "is", null)
    .is("archived_at", null)
    .order("full_name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: String(row.full_name ?? "—"),
    email: row.email != null ? String(row.email) : null,
  }));
}

export async function fetchRecentDeliveriesFeed(
  limit = 30,
): Promise<RecentDeliveryFeedItem[]> {
  await requirePerformanceView();
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
      drivers (driver_code, profiles!drivers_id_fkey (full_name)),
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

function emptyToNull<T>(arr: T[] | undefined): T[] | null {
  return arr && arr.length > 0 ? arr : null;
}

function rpcErrorCode(error: { message?: string; code?: string }): string {
  const message = String(error.message ?? "");
  if (message.includes("range_too_large")) return "range_too_large";
  if (message.includes("invalid_date_range")) return "invalid_date_range";
  if (message.includes("not_authorized")) return "not_authorized";
  return message || "rpc_failed";
}

function parseOpsKpis(raw: unknown): OpsKpis {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    orders: asInt(o.orders),
    orders_prev: asInt(o.orders_prev),
    overall_dpd: numOrNull(o.overall_dpd),
    overall_dpd_prev: numOrNull(o.overall_dpd_prev),
    avg_dpd_eff: numOrNull(o.avg_dpd_eff),
    avg_dpd_eff_prev: numOrNull(o.avg_dpd_eff_prev),
    avg_tgt_eff: numOrNull(o.avg_tgt_eff),
    avg_tgt_eff_prev: numOrNull(o.avg_tgt_eff_prev),
    riders: asInt(o.riders),
    riders_prev: asInt(o.riders_prev),
    active: asInt(o.active),
    active_prev: asInt(o.active_prev),
    working_days: asInt(o.working_days),
    stores_above: asInt(o.stores_above),
    stores_below: asInt(o.stores_below),
  };
}

function parseDim(raw: unknown): OpsDimRow {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    key: String(o.key ?? "—"),
    id: o.id != null ? String(o.id) : null,
    orders: asInt(o.orders),
    working_days: asInt(o.working_days),
    dpd: numOrNull(o.dpd),
    dpd_eff: numOrNull(o.dpd_eff),
    tgt_eff: numOrNull(o.tgt_eff),
    riders: asInt(o.riders),
    active_riders: o.active_riders == null ? undefined : asInt(o.active_riders),
    bikes: o.bikes == null ? undefined : asInt(o.bikes),
    cars: o.cars == null ? undefined : asInt(o.cars),
  };
}

function parseOpsSnapshot(raw: unknown): OpsSnapshot {
  const o = (raw ?? {}) as Record<string, unknown>;
  const optionsRaw = (o.options ?? {}) as Record<string, unknown>;
  const options: OpsOptions = {
    zones: Array.isArray(optionsRaw.zones)
      ? optionsRaw.zones.map((z) => {
          const row = (z ?? {}) as Record<string, unknown>;
          return { id: String(row.id ?? ""), name: String(row.name ?? "—") };
        })
      : [],
    restaurants: Array.isArray(optionsRaw.restaurants)
      ? optionsRaw.restaurants.map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          return { id: String(row.id ?? ""), name: String(row.name ?? "—") };
        })
      : [],
    nationalities: Array.isArray(optionsRaw.nationalities)
      ? optionsRaw.nationalities.map((n) => String(n))
      : [],
  };

  return {
    from: isoDate(o.from),
    to: isoDate(o.to),
    prev_from: isoDate(o.prev_from),
    prev_to: isoDate(o.prev_to),
    target_dpd: numOrNull(o.target_dpd) ?? 25,
    partner_mode:
      o.partner_mode === "americana" || o.partner_mode === "keeta"
        ? o.partner_mode
        : "all",
    kpis: parseOpsKpis(o.kpis),
    trend: Array.isArray(o.trend)
      ? o.trend.map((p): OpsTrendPoint => {
          const row = (p ?? {}) as Record<string, unknown>;
          return {
            bucket: isoDate(row.bucket),
            orders: asInt(row.orders),
            working_days: asInt(row.working_days),
            dpd: numOrNull(row.dpd),
            dpd_eff: numOrNull(row.dpd_eff),
            tgt_eff: numOrNull(row.tgt_eff),
          };
        })
      : [],
    by_vehicle: Array.isArray(o.by_vehicle) ? o.by_vehicle.map(parseDim) : [],
    by_zone: Array.isArray(o.by_zone) ? o.by_zone.map(parseDim) : [],
    by_partner: Array.isArray(o.by_partner) ? o.by_partner.map(parseDim) : [],
    by_nationality: Array.isArray(o.by_nationality)
      ? o.by_nationality.map(parseDim)
      : [],
    by_company: Array.isArray(o.by_company) ? o.by_company.map(parseDim) : [],
    stores: Array.isArray(o.stores)
      ? o.stores.map((s): OpsStoreRow => {
          const row = (s ?? {}) as Record<string, unknown>;
          return {
            store_id: asStr(row.store_id),
            store_name: asStr(row.store_name),
            zone_id: asStr(row.zone_id),
            zone_name: asStr(row.zone_name),
            orders: asInt(row.orders),
            working_days: asInt(row.working_days),
            riders: asInt(row.riders),
            active_riders: asInt(row.active_riders),
            store_dpd: numOrNull(row.store_dpd),
          };
        })
      : [],
    riders: Array.isArray(o.riders)
      ? o.riders.map((r): OpsRiderRow => {
          const row = (r ?? {}) as Record<string, unknown>;
          return {
            driver_id: String(row.driver_id ?? ""),
            name: String(row.name ?? "—"),
            employee_id: asStr(row.employee_id),
            driver_code: asStr(row.driver_code),
            zone_id: asStr(row.zone_id),
            zone: asStr(row.zone),
            vehicle_key: asStr(row.vehicle_key),
            nationality: asStr(row.nationality),
            project_key: asStr(row.project_key),
            store_id: asStr(row.store_id),
            store: asStr(row.store),
            source_type: asStr(row.source_type),
            source_company: asStr(row.source_company),
            orders: asInt(row.orders),
            working_days: asInt(row.working_days),
            dpd: numOrNull(row.dpd),
            target_dpd: numOrNull(row.target_dpd) ?? 25,
            store_dpd: numOrNull(row.store_dpd),
            veh_zone_dpd: numOrNull(row.veh_zone_dpd),
            dpd_eff: numOrNull(row.dpd_eff),
            tgt_eff: numOrNull(row.tgt_eff),
            status: row.status === "Active" ? "Active" : "Inactive",
          };
        })
      : [],
    options,
  };
}

export async function fetchPerformanceOpsBounds(): Promise<OpsBounds> {
  await requirePerformanceView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_performance_ops_bounds");
  if (error) throw new Error(rpcErrorCode(error));
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    today: isoDate(o.today),
    first_delivery_date: o.first_delivery_date ? isoDate(o.first_delivery_date) : null,
    span_days: asInt(o.span_days),
    over_cap: Boolean(o.over_cap),
  };
}

export async function fetchPerformanceOpsSnapshot(
  input: OpsQueryInput,
): Promise<OpsSnapshot> {
  await requirePerformanceView();
  const supabase = await createClient();
  const { slicers } = input;
  const { data, error } = await supabase.rpc("admin_performance_ops_snapshot", {
    p_from: input.from,
    p_to: input.to,
    p_project_keys: emptyToNull(slicers.projectKeys),
    p_zone_ids: emptyToNull(slicers.zoneIds),
    p_vehicle_keys: emptyToNull(slicers.vehicleKeys),
    p_nationalities: emptyToNull(slicers.nationalities),
    p_source_types: input.outsourceOnly
      ? null
      : emptyToNull(slicers.sourceTypes),
    p_source_companies: emptyToNull(slicers.sourceCompanies),
    p_restaurant_ids: emptyToNull(slicers.restaurantIds),
    p_outsource_only: input.outsourceOnly,
    p_granularity: input.granularity,
  });
  if (error) throw new Error(rpcErrorCode(error));
  return parseOpsSnapshot(data);
}

export async function fetchPerformanceTargetDpd(): Promise<TargetDpdRow[]> {
  await requireSettingsManage();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_performance_target_dpd");
  if (error) throw new Error(rpcErrorCode(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? ""),
      month: isoDate(o.month),
      target: numOrNull(o.target) ?? 25,
    };
  });
}

export async function savePerformanceTargetDpd(input: {
  month: string;
  target: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSettingsManage();
    const supabase = await createClient();
    const previous = await fetchPerformanceTargetDpd().catch(() => []);
    const { data, error } = await supabase.rpc(
      "admin_upsert_performance_target_dpd",
      { p_month: input.month, p_target: input.target },
    );
    if (error) return { success: false, error: rpcErrorCode(error) };
    void session;
    void logAdminMutation({
      action: "update",
      entityType: "performance_target_dpd",
      entityId: input.month,
      routeName: "savePerformanceTargetDpd",
      before: { rows: previous },
      after: { month: input.month, target: input.target, result: data },
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "update_failed",
    };
  }
}
