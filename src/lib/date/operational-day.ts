import { addKuwaitDays } from "@/lib/date/kuwait-dates";

/**
 * The operational day starts at 06:00 Asia/Kuwait and ends at 05:59:59.999 the
 * next calendar day — the same 06:00 → next-day 06:00 window the client's daily
 * order-count sheet uses, and the same window `report_delivery_orders` buckets
 * into when its `p_from_time` is not 00:00.
 *
 * Kuwait is UTC+3 all year (no DST), so the offset is a literal rather than a
 * timezone lookup. Both bounds are inclusive ISO instants, which keeps every
 * `gte`/`lte` filter contract unchanged. For `2026-09-30` the window is
 * `[2026-09-30T06:00:00.000+03:00, 2026-10-01T05:59:59.999+03:00]`, so 06:00
 * opens its own day and 05:59:59.999 on the next calendar day still closes it.
 *
 * This is deliberately a fixed constant and not an `app_settings` row: the
 * client's report is produced on this clock, so a configurable value could
 * silently disagree with the paperwork it is meant to reconcile against.
 */

const KUWAIT_TZ = "Asia/Kuwait";

/** Hour (Asia/Kuwait) at which the operational day rolls over. */
export const OPERATIONAL_DAY_START_HOUR = 6;

/** Same boundary as an `HH:mm` string, for UI defaults and comparisons. */
export const OPERATIONAL_DAY_START_HM = "06:00";

/** First instant of `ymd`'s operational day (inclusive). */
export function operationalDayStartIso(ymd: string): string {
  return `${ymd}T06:00:00.000+03:00`;
}

/** Last instant of `ymd`'s operational day (inclusive). */
export function operationalDayEndIso(ymd: string): string {
  return `${addKuwaitDays(ymd, 1)}T05:59:59.999+03:00`;
}

/** Inclusive ISO bounds of one operational day. */
export function operationalDayBounds(ymd: string): { from: string; to: string } {
  return { from: operationalDayStartIso(ymd), to: operationalDayEndIso(ymd) };
}

/** Inclusive ISO bounds spanning several operational days, `from`..`to`. */
export function operationalDayWindowBounds(
  fromYmd: string,
  toYmd: string,
): { from: string; to: string } {
  return { from: operationalDayStartIso(fromYmd), to: operationalDayEndIso(toYmd) };
}

/**
 * The operational day the given instant belongs to. Anything before 06:00
 * Kuwait is still part of yesterday's operational day.
 */
export function currentOperationalDayYmd(now: Date = new Date()): string {
  const { ymd, hour } = kuwaitYmdAndHour(now);
  return hour < OPERATIONAL_DAY_START_HOUR ? addKuwaitDays(ymd, -1) : ymd;
}

function kuwaitYmdAndHour(now: Date): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const ymd = `${read("year")}-${read("month")}-${read("day")}`;
  // Some runtimes emit "24" for midnight under hour12: false.
  const hour = Number(read("hour")) % 24;
  return { ymd, hour };
}
