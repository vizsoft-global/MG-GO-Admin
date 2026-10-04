/** True when both times are set and closing is not after opening. */
export function visitHoursInvalid(
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
): boolean {
  const open = openingTime?.trim() ?? "";
  const close = closingTime?.trim() ?? "";
  if (!open || !close) return false;
  return close <= open;
}

/** True when both lunch times are set and the window is outside opening–closing. */
export function lunchBreakOutsideHours(
  openingTime: string,
  closingTime: string,
  lunchStart: string | null | undefined,
  lunchEnd: string | null | undefined,
): boolean {
  const open = openingTime.trim();
  const close = closingTime.trim();
  const start = lunchStart?.trim() ?? "";
  const end = lunchEnd?.trim() ?? "";
  if (!open || !close || !start || !end) return false;
  return start < open || end > close;
}

/**
 * Whether a branch accepts visits on a given weekday (0 = Sunday).
 *
 * An **empty** `working_dows` means "not configured", not "closed every day".
 * The column defaults to `ARRAY[]` and the backfill only filled the branches
 * whose human-readable `working_days` matched the known Sun–Thu pattern, so
 * every other branch in production carries an empty array. Reading empty as
 * restrictive made the calendar board paint the entire week as Blocked — the
 * exact failure this helper exists to prevent.
 */
export function isBranchWorkingDay(
  workingDows: readonly number[] | null | undefined,
  dayOfWeek: number,
): boolean {
  if (!workingDows || workingDows.length === 0) return true;
  return workingDows.includes(dayOfWeek);
}

/**
 * Compact label for a `working_dows` set, e.g. `[0,1,2,3,4]` → `"Sun–Thu"`.
 * Returns null when nothing is configured, so callers can fall back to the
 * legacy `working_days` text instead of printing an empty weekday list.
 */
export function workingDowsLabel(
  workingDows: readonly number[] | null | undefined,
  labels: readonly string[],
): string | null {
  if (!workingDows || workingDows.length === 0) return null;
  const days = [...new Set(workingDows)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d < labels.length)
    .sort((a, b) => a - b);
  if (days.length === 0) return null;

  const runs: string[] = [];
  let start = days[0];
  let prev = days[0];
  for (const day of days.slice(1)) {
    if (day === prev + 1) {
      prev = day;
      continue;
    }
    runs.push(runLabel(start, prev, labels));
    start = day;
    prev = day;
  }
  runs.push(runLabel(start, prev, labels));
  return runs.join(", ");
}

function runLabel(start: number, end: number, labels: readonly string[]): string {
  return start === end ? labels[start] : `${labels[start]}–${labels[end]}`;
}
