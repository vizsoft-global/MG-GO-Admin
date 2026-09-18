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
