import { fetchAttendanceAnalyticsSummary } from "@/features/attendance/attendance-reporting-actions";
import { fetchAssetsCatalog } from "@/features/assets/assets-actions";
import { countDeliveriesByFilters } from "@/features/deliveries/deliveries-actions";
import { fetchFleetOpsCounts } from "@/features/driver-tracking/tracking-read-actions";
import { listNotificationCampaignsPage } from "@/features/notifications/notifications-actions";
import { fetchPayrollMonthSnapshot } from "@/features/payroll/payroll-actions";
import {
  fetchDriverPerformanceDetail,
  fetchDriverPerformanceList,
  fetchPerformanceOpsSnapshot,
  fetchPerformanceTrend,
} from "@/features/performance/performance-actions";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import {
  REQUEST_OPEN_STATUSES,
  requestStatusLabel,
} from "@/features/requests/request-status-utils";
import { listZonesForAssistant } from "@/features/zones/zones-read-actions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { scanCollection } from "./assistant-lookups";
import type { Permission } from "@/lib/auth/permissions";
import { kuwaitDayCreatedAtBounds, monthKeyFromYmd, resolveAssistantDateRange } from "./assistant-dates";
import { assistantModuleAllowed, requireAssistantModule } from "./assistant-gates";
import { ASSISTANT_RANK_CAP, ASSISTANT_RANK_ZONE_CAP } from "./assistant-entity";
import { sectionDenied, sectionUnavailable, stripNotificationRow, stripPerformanceRow } from "./assistant-strip";

type DateInput = { preset?: string; from?: string; to?: string };

export function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function compareScalars(
  current: Record<string, number | null | undefined>,
  previous: Record<string, number | null | undefined>,
): Record<string, { current: number | null; previous: number | null; delta: number | null }> {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const out: Record<string, { current: number | null; previous: number | null; delta: number | null }> = {};
  for (const key of keys) {
    const a = current[key];
    const b = previous[key];
    const curr = typeof a === "number" && Number.isFinite(a) ? a : null;
    const prev = typeof b === "number" && Number.isFinite(b) ? b : null;
    out[key] = {
      current: curr,
      previous: prev,
      delta: curr != null && prev != null ? Math.round((curr - prev) * 10) / 10 : null,
    };
  }
  return out;
}

export function rankByCount<T extends { count: number; label: string; id?: string }>(
  rows: T[],
  cap = ASSISTANT_RANK_CAP,
): T[] {
  return [...rows].sort((a, b) => b.count - a.count).slice(0, cap);
}

export function opsZonesToRankRows(
  rows: Array<{ key: string; id?: string | null; orders: number }>,
): Array<{ id?: string; label: string; count: number }> {
  return rows.map((row) => ({
    id: row.id ?? undefined,
    label: row.key,
    count: row.orders,
  }));
}

export function rankOrdersZoneResult(
  top: Array<{ id?: string; label: string; count: number }>,
  window: { from: string; to: string },
) {
  const first = top[0];
  return {
    kind: "rank_orders_zone" as const,
    window,
    headline: first
      ? { zone: first.label, orders: first.count, id: first.id }
      : null,
    cite: "headline.zone and headline.orders — never a fleet total",
    top,
    source: "performance_ops_verified" as const,
    page: "/performance",
    cap: ASSISTANT_RANK_CAP,
  };
}

function can(session: { permissions: ReadonlySet<string>; isSuperAdmin: boolean }, slug: Permission) {
  return assistantModuleAllowed(session.permissions, session.isSuperAdmin, slug);
}

function slicersFrom(input: { zone_id?: string; restaurant_id?: string; partner_id?: string }) {
  return {
    ...EMPTY_OPS_SLICERS,
    zoneIds: input.zone_id ? [input.zone_id] : [],
    restaurantIds: input.restaurant_id ? [input.restaurant_id] : [],
  };
}

async function vehicleCounts() {
  const data = await scanCollection(COLLECTIONS.vehicles);
  const byStatus: Record<string, number> = {};
  const byCondition: Record<string, number> = {};
  for (const row of data) {
    const status = String(row.status ?? "unknown");
    const condition = String(row.condition ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byCondition[condition] = (byCondition[condition] ?? 0) + 1;
  }
  return { total: data.length, by_status: byStatus, by_condition: byCondition };
}

export async function compareWindows(input: DateInput & {
  previous_preset?: string;
  previous_from?: string;
  previous_to?: string;
  zone_id?: string;
  restaurant_id?: string;
  partner_id?: string;
  zone_b_id?: string;
}) {
  const session = await requireAssistantModule("performance.view");
  const current = resolveAssistantDateRange(input);
  const previous = input.zone_b_id
    ? current
    : resolveAssistantDateRange({
        preset: input.previous_preset ?? "last_month",
        from: input.previous_from,
        to: input.previous_to,
      });
  const [a, b] = await Promise.all([
    fetchPerformanceOpsSnapshot({
      from: current.from,
      to: current.to,
      granularity: "daily",
      slicers: slicersFrom(input),
      outsourceOnly: false,
    }),
    fetchPerformanceOpsSnapshot({
      from: previous.from,
      to: previous.to,
      granularity: "daily",
      slicers: slicersFrom(input.zone_b_id ? { ...input, zone_id: input.zone_b_id } : input),
      outsourceOnly: false,
    }),
  ]);
  void logAdminRead("assistant", "assistant.tool", {
    tool: "compare_windows",
    window: current,
    previous,
  });
  return {
    current: { window: { from: a.from, to: a.to }, kpis: a.kpis, by_zone: a.by_zone.slice(0, 15), by_partner: a.by_partner.slice(0, 15) },
    previous: { window: { from: b.from, to: b.to }, kpis: b.kpis, by_zone: b.by_zone.slice(0, 15), by_partner: b.by_partner.slice(0, 15) },
    comparison: compareScalars(
      {
        orders: a.kpis.orders,
        riders: a.kpis.riders,
        overall_dpd: a.kpis.overall_dpd,
        avg_dpd_eff: a.kpis.avg_dpd_eff,
      },
      {
        orders: b.kpis.orders,
        riders: b.kpis.riders,
        overall_dpd: b.kpis.overall_dpd,
        avg_dpd_eff: b.kpis.avg_dpd_eff,
      },
    ),
    note: input.zone_b_id ? "zone_a_vs_zone_b" : "period_vs_period",
    partner_slicer: input.partner_id
      ? "unavailable_ops_snapshot_has_no_partner_ids"
      : undefined,
    session_ok: Boolean(session.id),
  };
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

export async function compareDriverWindows(input: DateInput & {
  driver_id: string;
  previous_preset?: string;
  previous_from?: string;
  previous_to?: string;
}) {
  await requireAssistantModule("performance.view");
  const current = resolveAssistantDateRange(input);
  const previous = resolveAssistantDateRange({
    preset: input.previous_preset ?? "last_month",
    from: input.previous_from,
    to: input.previous_to,
  });
  const curBounds = kuwaitDayCreatedAtBounds(current.from, current.to);
  const prevBounds = kuwaitDayCreatedAtBounds(previous.from, previous.to);
  const [a, b, curCounts, prevCounts] = await Promise.all([
    fetchDriverPerformanceDetail(input.driver_id, current.from, current.to),
    fetchDriverPerformanceDetail(input.driver_id, previous.from, previous.to),
    countDeliveriesByFilters({
      driverId: input.driver_id,
      dateFrom: curBounds.dateFrom,
      dateTo: curBounds.dateTo,
    }),
    countDeliveriesByFilters({
      driverId: input.driver_id,
      dateFrom: prevBounds.dateFrom,
      dateTo: prevBounds.dateTo,
    }),
  ]);
  void logAdminRead("assistant", "assistant.tool", {
    tool: "compare_driver_windows",
    id: input.driver_id,
    window: current,
    previous,
  });
  const curr = a ? stripPerformanceRow(a as unknown as Record<string, unknown>) : null;
  const prev = b ? stripPerformanceRow(b as unknown as Record<string, unknown>) : null;

  // `absent_days` is `COALESCE(..., 0)` in the rollup, so a window with no
  // record and a genuinely clean window both read 0. Deliveries come from
  // `admin_deliveries_counts_by_filters` so a month the performance rollup has
  // not written still reports the orders that were actually delivered, and
  // absence is only stated when the window has a record to speak from.
  const hasRecord = (row: Record<string, unknown> | null): boolean =>
    row != null && (finiteNumber(row.eligible_days) ?? 0) > 0;
  const absentOf = (row: Record<string, unknown> | null): number | null =>
    hasRecord(row) ? finiteNumber(row!.absent_days) : null;

  return {
    driver_id: input.driver_id,
    current: {
      window: current,
      row: curr,
      deliveries: curCounts,
    },
    previous: {
      window: previous,
      row: prev,
      deliveries: prevCounts,
    },
    comparison: compareScalars(
      {
        overall_score: finiteNumber(curr?.overall_score),
        deliveries: curCounts.total,
        verified_deliveries: curCounts.verified,
        worked_days: finiteNumber(curr?.worked_days),
        absent_days: absentOf(curr),
        compliance_score: finiteNumber(curr?.compliance_score),
      },
      {
        overall_score: finiteNumber(prev?.overall_score),
        deliveries: prevCounts.total,
        verified_deliveries: prevCounts.verified,
        worked_days: finiteNumber(prev?.worked_days),
        absent_days: absentOf(prev),
        compliance_score: finiteNumber(prev?.compliance_score),
      },
    ),
    record_note:
      curr && prev
        ? undefined
        : "one or both windows have no performance record; deliveries still come from admin_deliveries_counts_by_filters",
    source: "fetchDriverPerformanceDetail + admin_deliveries_counts_by_filters",
  };
}

export async function runAnalyticsQuery(input: DateInput & {
  kind:
    | "attendance_kpis"
    | "attendance_trend"
    | "requests_counts"
    | "payroll_kpis"
    | "vehicles_counts"
    | "fleet_ops"
    | "assets_kpis"
    | "notifications_history"
    | "performance_trend"
    | "rank_orders_zone"
    | "rank_complaints_zone"
    | "rank_complaints_restaurant"
    | "low_performance_high_absence";
  zone_id?: string;
  partner_id?: string;
}) {
  const range = resolveAssistantDateRange(input);
  const kind = input.kind;
  const module =
    kind.startsWith("attendance") || kind === "fleet_ops"
      ? "attendance.view"
      : kind === "requests_counts" || kind.startsWith("rank_complaints")
        ? "requests.view"
        : kind === "payroll_kpis"
          ? "payroll.view"
          : kind === "vehicles_counts"
            ? "vehicles.view"
            : kind === "assets_kpis"
              ? "assets.view"
              : kind === "notifications_history"
                ? "notifications.view"
                : "performance.view";
  const session = await requireAssistantModule(module);
  void logAdminRead("assistant", "assistant.tool", { tool: "analytics_query", kind, window: range });

  if (kind === "attendance_kpis" || kind === "attendance_trend") {
    const { daily } = await fetchAttendanceAnalyticsSummary(range.from, range.to);
    const totals = daily.reduce(
      (acc, day) => ({
        checked_in: acc.checked_in + day.checked_in,
        late: acc.late + day.late,
        absent: acc.absent + day.absent,
      }),
      { checked_in: 0, late: 0, absent: 0 },
    );
    return {
      kind,
      window: range,
      kpis: {
        ...totals,
        late_pct: percent(totals.late, totals.checked_in),
        absent_pct: percent(totals.absent, totals.checked_in + totals.absent),
      },
      trend: kind === "attendance_trend" ? daily : undefined,
    };
  }

  if (kind === "requests_counts") {
    const list = await fetchAdminRequestsList({
      datePreset: "all",
      zoneId: input.zone_id,
      limit: 1,
      offset: 0,
    });
    // The queue is the open statuses group — `kpi.pending` alone cannot name
    // which of them are waiting, and the raw enum (`in_review`) is not the
    // wording the panel or the rider app shows.
    const pendingOpen = REQUEST_OPEN_STATUSES.reduce(
      (sum, key) => sum + (list.statusCounts[key] ?? 0),
      0,
    );
    return {
      kind,
      window: range,
      kpi: list.kpi,
      filtered_total: list.filteredTotal,
      pending_open: pendingOpen,
      pending_label: "Pending / In Progress",
      open_statuses: REQUEST_OPEN_STATUSES.map((key) => ({
        key,
        label: requestStatusLabel(key),
        count: list.statusCounts[key] ?? 0,
      })),
      status_counts: Object.fromEntries(
        Object.entries(list.statusCounts).map(([key, value]) => [requestStatusLabel(key), value]),
      ),
    };
  }

  if (kind === "payroll_kpis") {
    const snap = await fetchPayrollMonthSnapshot({ monthKey: monthKeyFromYmd(range.to) });
    return { kind, month: snap.month, kpis: snap.payrollKpis, request_kpis: snap.requestKpis };
  }

  if (kind === "vehicles_counts") {
    return { kind, ...(await vehicleCounts()) };
  }

  if (kind === "fleet_ops") {
    return { kind, ...(await fetchFleetOpsCounts()) };
  }

  if (kind === "assets_kpis") {
    const { kpis } = await fetchAssetsCatalog();
    return { kind, kpis };
  }

  if (kind === "notifications_history") {
    const page = await listNotificationCampaignsPage({
      filters: { fromDate: range.from, toDate: range.to },
      limit: 10,
      page: 0,
    });
    return {
      kind,
      window: range,
      count: page.totalCount,
      head: page.rows.map((row) => stripNotificationRow(row as unknown as Record<string, unknown>)),
    };
  }

  if (kind === "performance_trend") {
    if (!can(session, "performance.analyze")) return { kind, ...sectionDenied("/performance") };
    const trend = await fetchPerformanceTrend({
      fromDate: range.from,
      toDate: range.to,
      zoneId: input.zone_id,
      partnerId: input.partner_id,
    });
    return { kind, window: range, trend };
  }

  if (kind === "rank_orders_zone") {
    const snap = await fetchPerformanceOpsSnapshot({
      from: range.from,
      to: range.to,
      granularity: "daily",
      slicers: EMPTY_OPS_SLICERS,
      outsourceOnly: false,
    });
    return rankOrdersZoneResult(
      rankByCount(opsZonesToRankRows(snap.by_zone)),
      { from: snap.from, to: snap.to },
    );
  }

  if (kind === "rank_complaints_restaurant") {
    return {
      kind,
      ...sectionUnavailable("requests_have_no_restaurant_id"),
      page: "/requests",
    };
  }

  if (kind === "rank_complaints_zone") {
    if (!can(session, "zones.view")) return { kind, ...sectionDenied("/zones") };
    const zones = (await listZonesForAssistant()).slice(0, ASSISTANT_RANK_ZONE_CAP);
    const ranked = await Promise.all(
      zones.map(async (zone) => {
        const list = await fetchAdminRequestsList({
          datePreset: "all",
          type: "complaint",
          zoneId: zone.id,
          limit: 1,
          offset: 0,
        });
        return { id: zone.id, label: zone.name, code: zone.code, count: list.filteredTotal };
      }),
    );
    return { kind, window: range, top: rankByCount(ranked), cap: ASSISTANT_RANK_ZONE_CAP };
  }

  if (kind === "low_performance_high_absence") {
    const list = await fetchDriverPerformanceList({
      fromDate: range.from,
      toDate: range.to,
      page: 0,
      pageSize: 50,
    });
    const mixed = list.rows
      .filter((row) => row.overall_score < 50 && row.absent_days > 0)
      .sort((a, b) => a.overall_score - b.overall_score || b.absent_days - a.absent_days)
      .slice(0, ASSISTANT_RANK_CAP)
      .map((row) => stripPerformanceRow(row as unknown as Record<string, unknown>));
    return { kind, window: range, count: mixed.length, head: mixed };
  }

  return { kind, error: "unknown_kind" };
}
