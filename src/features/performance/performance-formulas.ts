import {
  DEFAULT_PERFORMANCE_WEIGHTS,
  type PerformanceComponent,
  type PerformanceComponentKey,
  type PerformanceComponentScores,
  type PerformanceScoreWeights,
} from "./performance-types";

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function pct(ratio: number, digits = 0): string {
  return `${(clamp01(ratio) * 100).toFixed(digits)}%`;
}

export function rawPct(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "0%";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Parse/normalize weights from app_settings JSON. Equal defaults pending client sign-off. */
export function parsePerformanceWeights(raw: unknown): PerformanceScoreWeights {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (key: keyof PerformanceScoreWeights, fallback: number) => {
    const v = Number(obj[key]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    delivery: num("delivery", DEFAULT_PERFORMANCE_WEIGHTS.delivery),
    utilization: num("utilization", DEFAULT_PERFORMANCE_WEIGHTS.utilization),
    compliance: num("compliance", DEFAULT_PERFORMANCE_WEIGHTS.compliance),
    manual: num("manual", DEFAULT_PERFORMANCE_WEIGHTS.manual),
    exception_penalty: num(
      "exception_penalty",
      DEFAULT_PERFORMANCE_WEIGHTS.exception_penalty,
    ),
  };
}

/**
 * Blend the measured components into the compliance pillar, 0–100.
 *
 * Mirrors the `blended` CTE in admin_list_driver_performance. A component with
 * no value for the period is dropped **along with its weight**, so the pillar is
 * what it would have been with that component not configured at all. Scoring an
 * absent component as 0 would make it a penalty for whatever the period did not
 * contain — a driver who logged no deliveries has no on-time ratio, not a bad one.
 *
 * Returns null when nothing at all could be measured. Null is not 0: 0 says
 * "measured, and terrible", which is a much stronger claim than the data supports.
 */
export function computeComponentBlend(
  scores: PerformanceComponentScores,
  components: PerformanceComponent[],
): number | null {
  let num = 0;
  let den = 0;

  for (const component of components) {
    if (!component.is_active) continue;
    const weight = Math.max(0, component.weight);
    if (weight <= 0) continue;

    const value = scores[component.key];
    if (value == null || !Number.isFinite(value)) continue;

    num += weight * clamp01(value);
    den += weight;
  }

  if (den <= 0) return null;
  return Math.round((100 * num) / den * 10) / 10;
}

/**
 * Composite score 0–100. Mirrors admin_list_driver_performance.
 *
 * A null term is dropped along with its weight and the survivors renormalise.
 * `manualScore` null means no team has rated the driver; `complianceScore` null
 * means no component could be measured. Neither may be scored as 0 — that would
 * turn an unfinished review cycle, or a driver the rollup has no data for, into
 * a penalty. Dropping instead gives exactly the score that pillar not being
 * configured would have produced.
 */
export function computeOverallScore(
  deliveryEfficiency: number,
  utilization: number,
  complianceScore: number | null,
  weights: PerformanceScoreWeights = DEFAULT_PERFORMANCE_WEIGHTS,
  manualScore: number | null = null,
): number {
  const wD = Math.max(0, weights.delivery);
  const wU = Math.max(0, weights.utilization);
  const measured = complianceScore != null && Number.isFinite(complianceScore);
  const wC = measured ? Math.max(0, weights.compliance) : 0;
  const rated = manualScore != null && Number.isFinite(manualScore);
  const wM = rated ? Math.max(0, weights.manual) : 0;
  const sum = wD + wU + wC + wM || 1;
  const score =
    100 *
    ((wD * clamp01(deliveryEfficiency) +
      wU * clamp01(utilization) +
      wC * clamp01((complianceScore ?? 0) / 100) +
      wM * clamp01((manualScore ?? 0) / 100)) /
      sum);
  return Math.round(score * 10) / 10;
}

/**
 * Component score to a share, for a progress bar or a cell. Kept beside the
 * blend so a display can never disagree with the number it is illustrating.
 */
export function componentPct(
  scores: PerformanceComponentScores,
  key: PerformanceComponentKey,
): number | null {
  const value = scores[key];
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(clamp01(value) * 1000) / 10;
}

export function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
    new Date(),
  );
}

/**
 * The rating period a Kuwait date falls in, as the first of that month.
 * A rating is keyed on a month, so the date range on screen only decides which
 * month is being edited — never the identity of the rating itself.
 */
export function ratingPeriodMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function addDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export const PERFORMANCE_RANGE_PRESETS = [
  "last7",
  "last30",
  "thisMonth",
  "lastMonth",
] as const;

export type PerformanceRangePreset =
  (typeof PERFORMANCE_RANGE_PRESETS)[number];

/**
 * Resolve a preset against a Kuwait date. "This month" ends today rather than
 * at month end — a report must not claim days that have not happened.
 */
export function performanceRange(
  preset: PerformanceRangePreset,
  today: string,
): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisMonth":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "lastMonth": {
      const prevY = m === 1 ? y - 1 : y;
      const prevM = m === 1 ? 12 : m - 1;
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      return {
        from: `${prevY}-${pad(prevM)}-01`,
        to: `${prevY}-${pad(prevM)}-${pad(lastDay)}`,
      };
    }
  }
}
