/** Future days stay pickable only when the caller opts in (All Visits). */
export function dateRangeDisabledAfter(
  allowFutureDates = false,
): { after: Date } | undefined {
  return allowFutureDates ? undefined : { after: new Date() };
}
