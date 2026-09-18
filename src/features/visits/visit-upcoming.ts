/** Future-dated rows relative to a Kuwait YYYY-MM-DD calendar day. */
export function upcomingVisitCount(
  rows: readonly { scheduled_date: string | null }[],
  todayYmd: string,
): number {
  return rows.filter((row) => (row.scheduled_date ?? "") > todayYmd).length;
}
