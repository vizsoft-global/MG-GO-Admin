/** Due date is optional; when set it must be today or later (YYYY-MM-DD). */
export function isEsignDueDateAllowed(dueYmd: string, todayYmd: string): boolean {
  if (!dueYmd) return true;
  return dueYmd >= todayYmd;
}
