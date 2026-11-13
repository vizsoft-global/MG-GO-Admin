/**
 * Which day a completed order belongs to.
 *
 * Reconciliation and payroll follow the **booked shift**, not the calendar: a
 * rider on 13:00 → 01:00 has every order in that window counted under the day
 * the shift started, including the ones finished after midnight. `deliveries`
 * records that directly — `shift_date` is stamped at pickup from the rider's
 * active shift row and is never recomputed on completion — so it wins whenever
 * it is a real `YYYY-MM-DD`.
 *
 * A row without one is a delivery from before the stamp existed, or one taken
 * by a rider who booked no shift. Those fall back to the Kuwait calendar day of
 * `delivered_at`, which is what every report used before this existed. The
 * fallback is deliberate rather than a gap: a shift-less rider has no shift to
 * attribute to, and inventing one would move their orders onto a day nobody
 * approved.
 *
 * The same two rules are used by the Order Comparison snapshot, the recon
 * commit and the Performance snapshot, so the four surfaces cannot disagree
 * about the day of an overnight order.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * How far past the last requested day a delivery scan has to reach.
 *
 * A shift that starts on the last day of a range runs into the next one, and
 * those orders still belong to the last day. Twelve hours covers every shift
 * window the roster carries (the latest end seen in production is 05:00 with a
 * day offset of 1), and the bucket check that runs afterwards is what stops the
 * extra span from leaking into a day the caller did not ask for.
 */
export const SHIFT_TAIL_HOURS = 12;

function kuwaitOffsetMs(): number {
  return 3 * 60 * 60 * 1000;
}

/** Kuwait calendar `YYYY-MM-DD` for an instant. */
export function kuwaitDayOf(ms: number): string {
  return new Date(ms + kuwaitOffsetMs()).toISOString().slice(0, 10);
}

/** Start of a Kuwait day, as an epoch instant. */
export function kuwaitDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+03:00`);
}

/** End of a Kuwait day, as an epoch instant (exclusive). */
export function kuwaitDayEndMs(day: string): number {
  return kuwaitDayStartMs(day) + DAY_MS;
}

export function isDayString(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  // `Date.parse("2026-02-30")` silently rolls over to March, so the day is
  // checked against the month's real length instead of trusting the parser.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/**
 * The day a completed order is counted on.
 *
 * `shiftDate` is whatever the document carries — a string, or `null`/absent on a
 * legacy row. Anything that is not a real `YYYY-MM-DD` is ignored rather than
 * trusted, because a malformed value would otherwise land the order on a day no
 * report can select.
 */
export function resolveWorkDay(deliveredAtMs: number | null, shiftDate: unknown): string | null {
  if (isDayString(shiftDate)) return shiftDate;
  if (deliveredAtMs === null || !Number.isFinite(deliveredAtMs)) return null;
  return kuwaitDayOf(deliveredAtMs);
}

/** The exclusive instant a delivery scan for `[from, to]` has to stop at. */
export function scanUpperMs(toDay: string): number {
  return kuwaitDayEndMs(toDay) + SHIFT_TAIL_HOURS * 60 * 60 * 1000;
}

/**
 * One row per delivery id.
 *
 * A chunked scan extends each slice past its last day so overnight shifts are
 * included, which means the tail of one slice and the head of the next overlap
 * by `SHIFT_TAIL_HOURS`. Counting the concatenated list therefore counted those
 * orders twice — and because a 01:00 order carries the *previous* day's
 * `shift_date`, the duplicate fell inside the requested range both times, so it
 * doubled the day cell rather than being filtered out. Deduplicating on the
 * document id is what makes a sliced scan equal to the single query it replaces.
 */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
