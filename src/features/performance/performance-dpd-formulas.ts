import type { DpdEfficiencyRider } from "./performance-types";

/** Raw actual / target. Null when target is missing or zero — never divide by zero. */
export function dpdEfficiency(
  actual: number,
  target: number | null | undefined,
): number | null {
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  if (!Number.isFinite(actual)) return null;
  return actual / target;
}

/** actual / worked_days. Null when the rider did not work — never paint 0. */
export function dpdRiderRate(
  actual: number,
  workedDays: number | null | undefined,
): number | null {
  if (workedDays == null || !Number.isFinite(workedDays) || workedDays <= 0) {
    return null;
  }
  if (!Number.isFinite(actual)) return null;
  return actual / workedDays;
}

export function formatUncappedPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

/**
 * Efficiency ranking: exclude null/0 target. Ties go to more actuals first.
 */
export function rankByEfficiency(
  riders: DpdEfficiencyRider[],
  direction: "desc" | "asc",
  limit = 10,
): DpdEfficiencyRider[] {
  const ranked = riders.filter(
    (r) => r.efficiency != null && r.target != null && r.target > 0,
  );
  ranked.sort((a, b) => {
    const ea = a.efficiency ?? 0;
    const eb = b.efficiency ?? 0;
    if (ea !== eb) return direction === "desc" ? eb - ea : ea - eb;
    return direction === "desc" ? b.actual - a.actual : a.actual - b.actual;
  });
  return ranked.slice(0, limit);
}

/** DPD Rider ranking excludes zero worked days. */
export function rankByDpdRider(
  riders: DpdEfficiencyRider[],
  direction: "desc" | "asc",
  limit = 10,
): DpdEfficiencyRider[] {
  const ranked = riders.filter((r) => r.dpd_rider != null && r.worked_days > 0);
  ranked.sort((a, b) => {
    const da = a.dpd_rider ?? 0;
    const db = b.dpd_rider ?? 0;
    if (da !== db) return direction === "desc" ? db - da : da - db;
    return direction === "desc" ? b.actual - a.actual : a.actual - b.actual;
  });
  return ranked.slice(0, limit);
}
