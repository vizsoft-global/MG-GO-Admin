/**
 * The D-level rule, as maths with no Firestore in it.
 *
 * A rider is level D when the month-to-date verified deliveries fall short of
 * what the target says the days they actually worked required:
 *
 *   required = active_days x target_dpd
 *   level D  = verified < required
 *
 * The two inputs are deliberately different units. `active_days` counts the
 * Kuwait days the rider was present (an attendance row with a check-in, or a
 * verified delivery when attendance was never captured), and `target_dpd` is the
 * per-day target that already prices their store. Counting orders alone would
 * flag a rider who worked two days, and counting days alone would flag one who
 * worked all month at a slower store.
 *
 * `minActiveDays` exists because the first day of a month always shows a
 * one-day deficit: a rider who has not started yet is not a D rider, they are a
 * rider with no history. Everything below that floor stays `standard`, and the
 * metrics still ride along so a panel can show the shortfall without acting on
 * it.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const DRIVER_LEVEL_D = "D";
export const DRIVER_LEVEL_STANDARD = "standard";
export type DriverLevelKey = typeof DRIVER_LEVEL_D | typeof DRIVER_LEVEL_STANDARD;

/** Days of history before the classification may say `D`. */
export const DRIVER_LEVEL_MIN_ACTIVE_DAYS = 3;

/** The global monthly target used when no delivery rule resolves one. */
export const DRIVER_LEVEL_FALLBACK_TARGET = 25;

export type DriverLevelMetrics = {
  /** `YYYY-MM` (Asia/Kuwait). */
  month: string;
  /** Kuwait days present in the month, capped at today. */
  active_days: number;
  mtd_verified_deliveries: number;
  target_dpd: number;
  required_orders: number;
  /** required − verified. Positive means the rider is short. */
  gap: number;
  /** verified ÷ active days, or null when nothing was worked yet. */
  dpd: number | null;
  /** `1` on the first Kuwait day of the month, when the window is a partial one. */
  days_elapsed: number;
};

export type DriverLevelVerdict = {
  level: DriverLevelKey;
  metrics: DriverLevelMetrics;
};

export function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `YYYY-MM` plus today's Kuwait day, to the inclusive window the month covers.
 *
 * A month that has not started returns `{from, to}` with `to` before `from`,
 * which callers treat as "no rows" rather than an error — an admin asking for
 * December in November is a question about the future, not a bad request.
 */
export function driverLevelWindow(month: string, today: string): { from: string; to: string } {
  const [year, monthIndex] = month.split("-").map((part) => Number(part));
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const from = `${month}-01`;
  const last = `${month}-${lastDay < 10 ? "0" : ""}${lastDay}`;
  const to = today < from ? "" : today > last ? last : today;
  return { from, to };
}

/** Kuwait days elapsed in the month up to `to`, inclusive. 0 for a bad window. */
export function driverLevelDaysElapsed(from: string, to: string): number {
  if (from === "" || to === "" || to < from) return 0;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function resolveDriverLevel(args: {
  month: string;
  activeDays: number;
  verifiedDeliveries: number;
  targetDpd: number;
  minActiveDays?: number;
  daysElapsed?: number;
}): DriverLevelVerdict {
  const activeDays = Math.max(0, Math.trunc(args.activeDays));
  const verified = Math.max(0, Math.trunc(args.verifiedDeliveries));
  // A non-positive target is not a target. Returning 0 would require 0 orders
  // and mark the whole fleet standard on a bad settings row; the fallback keeps
  // the classification honest instead of silently inert.
  const target =
    Number.isFinite(args.targetDpd) && args.targetDpd > 0
      ? args.targetDpd
      : DRIVER_LEVEL_FALLBACK_TARGET;
  const required = Math.round(activeDays * target * 100) / 100;
  const gap = Math.round((required - verified) * 100) / 100;
  const floor = args.minActiveDays ?? DRIVER_LEVEL_MIN_ACTIVE_DAYS;

  return {
    level: activeDays >= floor && gap > 0 ? DRIVER_LEVEL_D : DRIVER_LEVEL_STANDARD,
    metrics: {
      month: args.month,
      active_days: activeDays,
      mtd_verified_deliveries: verified,
      target_dpd: target,
      required_orders: required,
      gap,
      dpd: activeDays > 0 ? roundMetric(verified / activeDays) : null,
      days_elapsed: args.daysElapsed ?? 0,
    },
  };
}

/**
 * The level the panel and the app print: an admin override wins, otherwise the
 * sweep's own verdict.
 *
 * `null` is not `standard`. An override of `null` means "nobody has decided",
 * which leaves the automatic verdict in place; clearing an override is the only
 * way back to it.
 */
export function effectiveDriverLevel(
  autoLevel: string | null | undefined,
  overrideLevel: string | null | undefined,
): DriverLevelKey {
  if (overrideLevel === DRIVER_LEVEL_D) return DRIVER_LEVEL_D;
  if (overrideLevel === DRIVER_LEVEL_STANDARD) return DRIVER_LEVEL_STANDARD;
  return autoLevel === DRIVER_LEVEL_D ? DRIVER_LEVEL_D : DRIVER_LEVEL_STANDARD;
}

export function parseDriverLevelKey(raw: string | null | undefined): DriverLevelKey | null {
  if (raw === DRIVER_LEVEL_D) return DRIVER_LEVEL_D;
  if (raw === DRIVER_LEVEL_STANDARD) return DRIVER_LEVEL_STANDARD;
  return null;
}
