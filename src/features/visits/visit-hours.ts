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
