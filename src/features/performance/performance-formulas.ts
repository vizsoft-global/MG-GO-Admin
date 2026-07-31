import {
  DEFAULT_PERFORMANCE_WEIGHTS,
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
    exception_penalty: num(
      "exception_penalty",
      DEFAULT_PERFORMANCE_WEIGHTS.exception_penalty,
    ),
  };
}

/**
 * Composite score 0–100.
 * OPEN: default equal weights need client/product sign-off.
 */
export function computeOverallScore(
  deliveryEfficiency: number,
  utilization: number,
  complianceScore: number,
  weights: PerformanceScoreWeights = DEFAULT_PERFORMANCE_WEIGHTS,
): number {
  const wD = Math.max(0, weights.delivery);
  const wU = Math.max(0, weights.utilization);
  const wC = Math.max(0, weights.compliance);
  const sum = wD + wU + wC || 1;
  const score =
    100 *
    ((wD * clamp01(deliveryEfficiency) +
      wU * clamp01(utilization) +
      wC * clamp01(complianceScore / 100)) /
      sum);
  return Math.round(score * 10) / 10;
}

export function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
    new Date(),
  );
}

export function addDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}
