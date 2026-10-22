import { addKuwaitDays } from "@/lib/date/kuwait-dates";

/**
 * The Firestore window for `deliveries.delivered_at`, which is a Timestamp.
 *
 * The fallback used to send ISO strings to a timestamp field, so the query
 * matched nothing and the page looked empty even when the fallback ran. Kuwait
 * has no DST, so `+03:00` is the same boundary `kuwaitDayStart` / `kuwaitDayEnd`
 * use in the functions package; `endExclusive` is the next day's midnight so the
 * `to` day is fully included.
 */
export function deliveryDayBounds(
  from: string,
  to: string,
): { start: Date; endExclusive: Date } {
  return {
    start: new Date(`${from}T00:00:00+03:00`),
    endExclusive: new Date(`${addKuwaitDays(to, 1)}T00:00:00+03:00`),
  };
}
