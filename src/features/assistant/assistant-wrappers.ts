import { countDeliveriesByFilters } from "@/features/deliveries/deliveries-actions";
import { fetchIncentiveDailyReport } from "@/features/earnings/earnings-actions";
import type { IncentiveDailyReport } from "@/features/earnings/incentive-daily-report";
import {
  fetchDpdEfficiencySnapshot,
  fetchDpdLiveSnapshot,
  fetchDriverPerformanceList,
  fetchDriverPerformanceRank,
} from "@/features/performance/performance-actions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import {
  kuwaitDayCreatedAtBounds,
  resolveAssistantDateRange,
  resolveAssistantLiveDate,
} from "./assistant-dates";
import {
  resolveDriverId,
  resolvePartnerId,
  resolveRestaurantId,
  resolveZoneId,
} from "./assistant-lookups";
import { assertNoOrderRows, refuseToolArgs } from "./assistant-refuse";
import type { AssistantExportSpec } from "./assistant-contract";

type DateInput = { preset?: string; from?: string; to?: string };

function fail(error: string) {
  return { error };
}

function asError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "not_authorized") return "not_authorized";
    return err.message;
  }
  return "tool_failed";
}

export function summarizeIncentiveDaily(
  report: IncentiveDailyReport,
  oneRider: boolean,
) {
  const total_kwd = report.rows.reduce((sum, row) => sum + row.daily_amount_kwd, 0);
  const rules = [...new Set(report.rows.map((row) => row.applied_rule).filter(Boolean))];
  if (oneRider) {
    const first = report.rows[0];
    return {
      from: report.from,
      to: report.to,
      rider: first
        ? {
            name: first.driver_name,
            driver_code: first.driver_code,
            employee_id: first.employee_id,
          }
        : null,
      days: report.rows.map((row) => ({
        earn_date: row.earn_date,
        restaurant_name: row.restaurant_name,
        deliveries: row.deliveries,
        applied_rule: row.applied_rule,
        daily_amount_kwd: row.daily_amount_kwd,
      })),
      total_kwd,
      rules,
    };
  }
  const byDate = new Map<
    string,
    { earn_date: string; amount_kwd: number; deliveries: number; rules: Set<string> }
  >();
  for (const row of report.rows) {
    const cur = byDate.get(row.earn_date) ?? {
      earn_date: row.earn_date,
      amount_kwd: 0,
      deliveries: 0,
      rules: new Set<string>(),
    };
    cur.amount_kwd += row.daily_amount_kwd;
    cur.deliveries += row.deliveries;
    if (row.applied_rule) cur.rules.add(row.applied_rule);
    byDate.set(row.earn_date, cur);
  }
  return {
    from: report.from,
    to: report.to,
    rider_day_rows: report.rows.length,
    daily: [...byDate.values()]
      .sort((a, b) => a.earn_date.localeCompare(b.earn_date))
      .map((row) => ({
        earn_date: row.earn_date,
        amount_kwd: row.amount_kwd,
        deliveries: row.deliveries,
        rules: [...row.rules],
      })),
    total_kwd,
    rules,
  };
}

export async function runDpdEfficiency(input: DateInput & {
  restaurant?: string;
  zone?: string;
  partner?: string;
}) {
  const refused = refuseToolArgs(input as Record<string, unknown>);
  if (refused) return fail(refused);
  try {
    const range = resolveAssistantDateRange(input);
    const [restaurant, zone, partner] = await Promise.all([
      resolveRestaurantId(input.restaurant),
      resolveZoneId(input.zone),
      resolvePartnerId(input.partner),
    ]);
    const snap = await fetchDpdEfficiencySnapshot({
      from: range.from,
      to: range.to,
      restaurantId: restaurant.id,
      zoneId: zone.id,
      partnerId: partner.id,
    });
    const exportSpec: AssistantExportSpec = {
      kind: "dpd_efficiency",
      from: snap.from,
      to: snap.to,
      filters: {
        restaurantId: restaurant.id,
        zoneId: zone.id,
        partnerId: partner.id,
      },
    };
    void logAdminRead("dpd_efficiency", "assistant.tool", {
      tool: "dpd_efficiency",
      from: snap.from,
      to: snap.to,
      filters: exportSpec.filters,
    });
    return {
      from: snap.from,
      to: snap.to,
      rider_count: snap.riders.length,
      restaurants: snap.restaurants.slice(0, 20),
      zones: snap.zones.slice(0, 20),
      top10: snap.top10.slice(0, 10),
      bottom10: snap.bottom10.slice(0, 10),
      filters: {
        restaurant: restaurant.name,
        zone: zone.name,
        partner: partner.name,
      },
      export: exportSpec,
    };
  } catch (err) {
    return fail(asError(err));
  }
}

export async function runDeliveriesCounts(input: DateInput & {
  zone?: string;
  partner?: string;
}) {
  const refused = refuseToolArgs(input as Record<string, unknown>);
  if (refused) return fail(refused);
  try {
    const range = resolveAssistantDateRange(input);
    const bounds = kuwaitDayCreatedAtBounds(range.from, range.to);
    const [zone, partner] = await Promise.all([
      resolveZoneId(input.zone),
      resolvePartnerId(input.partner),
    ]);
    const counts = await countDeliveriesByFilters({
      dateFrom: bounds.dateFrom,
      dateTo: bounds.dateTo,
      zoneId: zone.id,
      partnerId: partner.id,
    });
    assertNoOrderRows(counts);
    const exportSpec: AssistantExportSpec = {
      kind: "deliveries_counts",
      from: range.from,
      to: range.to,
      filters: { zoneId: zone.id, partnerId: partner.id },
    };
    void logAdminRead("deliveries_counts", "assistant.tool", {
      tool: "deliveries_counts",
      from: range.from,
      to: range.to,
      filters: exportSpec.filters,
    });
    return {
      ...counts,
      from: range.from,
      to: range.to,
      zone: zone.name,
      partner: partner.name,
      export: exportSpec,
    };
  } catch (err) {
    return fail(asError(err));
  }
}

export async function runIncentiveDaily(input: DateInput & {
  rider?: string;
  restaurant?: string;
}) {
  const refused = refuseToolArgs(input as Record<string, unknown>);
  if (refused) return fail(refused);
  try {
    const range = resolveAssistantDateRange(input);
    const [driver, restaurant] = await Promise.all([
      resolveDriverId(input.rider),
      resolveRestaurantId(input.restaurant),
    ]);
    const report = await fetchIncentiveDailyReport({
      from: range.from,
      to: range.to,
      driverId: driver.id,
      restaurantId: restaurant.id,
    });
    const exportSpec: AssistantExportSpec = {
      kind: "incentive_daily",
      from: report.from,
      to: report.to,
      filters: { driverId: driver.id, restaurantId: restaurant.id },
    };
    void logAdminRead("incentive_daily", "assistant.tool", {
      tool: "incentive_daily",
      from: report.from,
      to: report.to,
      filters: exportSpec.filters,
    });
    return {
      ...summarizeIncentiveDaily(report, Boolean(driver.id)),
      filters: { rider: driver.name ?? driver.driver_code, restaurant: restaurant.name },
      export: exportSpec,
    };
  } catch (err) {
    return fail(asError(err));
  }
}

export async function runPerformanceBands(input: DateInput & {
  rider?: string;
  zone?: string;
  partner?: string;
  restaurant?: string;
}) {
  const refused = refuseToolArgs(input as Record<string, unknown>);
  if (refused) return fail(refused);
  try {
    const range = resolveAssistantDateRange(input);
    const [driver, zone, partner, restaurant] = await Promise.all([
      resolveDriverId(input.rider),
      resolveZoneId(input.zone),
      resolvePartnerId(input.partner),
      resolveRestaurantId(input.restaurant),
    ]);
    const list = await fetchDriverPerformanceList({
      fromDate: range.from,
      toDate: range.to,
      zoneId: zone.id,
      partnerId: partner.id,
      restaurantId: restaurant.id,
      driverId: driver.id,
      page: 0,
      pageSize: 1,
    });
    let rider: {
      band: string | null;
      rank: number | null;
      score: number | null;
      name?: string;
      total: number;
    } | null = null;
    if (driver.id) {
      const rank = await fetchDriverPerformanceRank(driver.id, range.from, range.to);
      const row = list.rows.find((entry) => entry.driver_id === driver.id);
      rider = {
        band: rank.band,
        rank: rank.rank,
        score: row?.overall_score ?? null,
        name: row?.driver_name ?? driver.name,
        total: rank.total,
      };
    }
    const exportSpec: AssistantExportSpec = {
      kind: "performance_bands",
      from: list.from,
      to: list.to,
      filters: {
        zoneId: zone.id,
        partnerId: partner.id,
        restaurantId: restaurant.id,
        driverId: driver.id,
      },
    };
    void logAdminRead("performance_bands", "assistant.tool", {
      tool: "performance_bands",
      from: list.from,
      to: list.to,
      filters: exportSpec.filters,
    });
    return {
      from: list.from,
      to: list.to,
      bands: {
        top: list.kpis.band_top,
        good: list.kpis.band_good,
        watch: list.kpis.band_watch,
        critical: list.kpis.band_critical,
      },
      rider,
      export: exportSpec,
    };
  } catch (err) {
    return fail(asError(err));
  }
}

export async function runPerformanceLive(input: { date?: string }) {
  const refused = refuseToolArgs(input as Record<string, unknown>);
  if (refused) return fail(refused);
  try {
    const snap = await fetchDpdLiveSnapshot(resolveAssistantLiveDate(input.date));
    const exportSpec: AssistantExportSpec = {
      kind: "performance_live",
      from: snap.date,
      to: snap.date,
      filters: {},
    };
    void logAdminRead("performance_live", "assistant.tool", {
      tool: "performance_live",
      from: snap.date,
      to: snap.date,
      filters: {},
    });
    return {
      date: snap.date,
      roster: snap.roster,
      deliveries: snap.deliveries,
      alerts: snap.alerts,
      export: exportSpec,
    };
  } catch (err) {
    return fail(asError(err));
  }
}

export async function runExportReport(input: Record<string, unknown>) {
  const refused = refuseToolArgs(input);
  if (refused) return fail(refused);
  const kind = String(input.kind ?? "");
  if (kind === "report_delivery_orders") return fail("report_delivery_orders");
  const from = String(input.from ?? "").slice(0, 10);
  const to = String(input.to ?? "").slice(0, 10);
  if (!from || !to) return fail("invalid_date_range");
  return {
    kind,
    from,
    to,
    filters: (input.filters as Record<string, string | undefined>) ?? {},
  };
}
