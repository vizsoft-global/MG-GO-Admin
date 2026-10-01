import { zoneCategoryFor, type ZoneCategory } from "./payroll-rules-engine";

/**
 * MGGO Payroll SOP v4.0 — zone efficiency.
 *
 * SOP section 6: zone efficiency is calculated from the previous completed
 * month only. DPD = zone orders / rider days; Target DPD = the average DPD;
 * Zone efficiency % = DPD / Target DPD × 100, banded Good ≥ 110,
 * Average ≥ 70, Low < 70.
 *
 * The SQL recompute (admin_recompute_payroll_zone_metrics) is the source of
 * truth in production; this module is the same arithmetic in TypeScript so the
 * panel can preview a threshold change, the Settings tab can show what a
 * recompute would produce, and the banding is unit-tested in one place.
 */

export type ZoneScanRow = {
  zoneId: string;
  zoneName: string;
  orders: number;
  riderDays: number;
};

export type ZoneCategoryOverride = "good" | "average" | "low" | null;

export type ZoneMetricInput = {
  zoneId: string;
  zoneName: string;
  orders: number;
  riderDays: number;
  dpdUsed?: number | null;
  targetDpdUsed?: number | null;
  categoryOverride?: ZoneCategoryOverride;
  goodThreshold?: number;
  averageThreshold?: number;
};

export type ZoneMetric = {
  zoneId: string;
  zoneName: string;
  orders: number;
  riderDays: number;
  /** Zone orders / rider days. Null when the zone had no rider days. */
  dpd: number | null;
  /** Average DPD across the zones that had rider days. */
  targetDpd: number | null;
  /** Override in force, else null meaning "use dpd". */
  dpdUsedOverride: number | null;
  targetDpdUsedOverride: number | null;
  /** The figure the banding actually used. */
  dpdValue: number | null;
  targetDpdValue: number | null;
  efficiency: number | null;
  categoryAuto: ZoneCategory;
  categoryOverride: ZoneCategoryOverride;
  category: ZoneCategory;
  goodThreshold: number;
  averageThreshold: number;
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function positiveOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Target DPD is the average DPD of the zones that actually had rider days.
 * A zone with no rider days has no DPD to average — including it as 0 would
 * drag the whole fleet's target down and band every working zone "Good".
 */
export function averageDpd(rows: readonly ZoneScanRow[]): number | null {
  const active = rows.filter((r) => r.riderDays > 0);
  if (active.length === 0) return null;
  const total = active.reduce((sum, r) => sum + r.orders / r.riderDays, 0);
  return round4(total / active.length);
}

export function computeZoneMetric(
  row: ZoneScanRow,
  targetDpd: number | null,
  input: Omit<ZoneMetricInput, "zoneId" | "zoneName" | "orders" | "riderDays"> = {},
): ZoneMetric {
  const goodThreshold = input.goodThreshold ?? 110;
  const averageThreshold = input.averageThreshold ?? 70;

  const dpd = row.riderDays > 0 ? round4(row.orders / row.riderDays) : null;
  const dpdValue = input.dpdUsed ?? dpd;
  const targetValue = input.targetDpdUsed ?? targetDpd;
  const efficiency =
    positiveOrNull(dpdValue) !== null && positiveOrNull(targetValue) !== null
      ? round4(((dpdValue as number) / (targetValue as number)) * 100)
      : null;

  const categoryAuto = zoneCategoryFor(efficiency, goodThreshold, averageThreshold);
  const categoryOverride = input.categoryOverride ?? null;

  return {
    zoneId: row.zoneId,
    zoneName: row.zoneName,
    orders: row.orders,
    riderDays: row.riderDays,
    dpd,
    targetDpd: targetDpd === null ? null : round4(targetDpd),
    dpdUsedOverride: input.dpdUsed ?? null,
    targetDpdUsedOverride: input.targetDpdUsed ?? null,
    dpdValue,
    targetDpdValue: targetValue === null ? null : round4(targetValue),
    efficiency,
    categoryAuto,
    categoryOverride,
    category: categoryOverride ?? categoryAuto,
    goodThreshold,
    averageThreshold,
  };
}

/**
 * Every zone for the month. `overrides` carries the Ops decisions, and a
 * recompute must never discard one — the same rule the SQL enforces.
 */
export function computeZoneMetrics(
  rows: readonly ZoneScanRow[],
  overrides: ReadonlyMap<
    string,
    {
      dpdUsed?: number | null;
      targetDpdUsed?: number | null;
      categoryOverride?: ZoneCategoryOverride;
      goodThreshold?: number;
      averageThreshold?: number;
    }
  > = new Map(),
): ZoneMetric[] {
  const target = averageDpd(rows);
  return rows
    .map((row) => {
      const o = overrides.get(row.zoneId);
      return computeZoneMetric(row, o?.targetDpdUsed ?? target, {
        dpdUsed: o?.dpdUsed ?? null,
        targetDpdUsed: o?.targetDpdUsed ?? null,
        categoryOverride: o?.categoryOverride ?? null,
        goodThreshold: o?.goodThreshold,
        averageThreshold: o?.averageThreshold,
      });
    })
    .sort((a, b) => a.zoneName.localeCompare(b.zoneName));
}

/** The category the rules must match on: an Ops override beats the automatic band. */
export function resolveCategory(metric: {
  category?: ZoneCategory;
  categoryOverride?: ZoneCategoryOverride;
  categoryAuto?: ZoneCategory;
}): ZoneCategory {
  if (metric.category) return metric.category;
  return metric.categoryOverride ?? metric.categoryAuto ?? "not_set";
}

/**
 * The category to use for a rider's day rules. A zone the metrics never
 * measured is `not_set`, which no seeded rule matches — so an unmeasured zone
 * falls through to the client default rather than being banded "Low" by
 * absence.
 */
export function categoryForZone(
  metrics: readonly {
    zoneId: string;
    category?: ZoneCategory;
    categoryOverride?: ZoneCategoryOverride;
    categoryAuto?: ZoneCategory;
  }[],
  zoneId: string | null | undefined,
): ZoneCategory {
  if (!zoneId) return "not_set";
  const found = metrics.find((m) => m.zoneId === zoneId);
  return found ? resolveCategory(found) : "not_set";
}

export function formatDpd(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatZonePct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
