/** Kuwait calendar date for driver_earnings_daily.earn_date.
 *  Null when the delivery never had delivered_at (cancelled / pending).
 *  Mirrors trg_deliveries_recalc_earnings — never pass a null earn_date. */
export function earningsRecalcDateFromDeliveredAt(
  deliveredAt: string | null | undefined,
): string | null {
  if (deliveredAt == null || deliveredAt === "") return null;
  const d = new Date(deliveredAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
