/** Due date is optional; when set it must be today or later (YYYY-MM-DD). */
export function isEsignDueDateAllowed(dueYmd: string, todayYmd: string): boolean {
  if (!dueYmd) return true;
  return dueYmd >= todayYmd;
}

/** Kuwait calendar day of a date / timestamptz wire value. */
export function esignDueYmd(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const ymd = dueAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/**
 * Pending rows whose due date is before Kuwait today read as Expired.
 * Signed / declined / cancelled stay as stored.
 */
export function effectiveEsignStatus(
  status: string,
  dueAt: string | null | undefined,
  todayYmd: string,
): string {
  if (status !== "pending") return status;
  const due = esignDueYmd(dueAt);
  if (due && due < todayYmd) return "expired";
  return status;
}
