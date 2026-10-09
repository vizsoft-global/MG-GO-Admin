/**
 * Kuwait calendar helpers, mirroring the SQL.
 *
 * Asia/Kuwait is a fixed UTC+3 with no DST, which is why the handlers can do
 * half-open day arithmetic on plain arithmetic instead of a timezone library.
 * The value that matters is the **stored** `YYYY-MM-DD` string: queries filter on
 * it, so a day can never be re-derived differently at read time from how it was
 * written.
 */

export const KUWAIT_OFFSET_HOURS = 3;
export const KUWAIT_OFFSET_MS = KUWAIT_OFFSET_HOURS * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The 05:00 operational day, used by the Orders Report and shift-day fields. */
export const OPERATIONAL_DAY_START_HOUR = 5;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` for an instant's Kuwait calendar day. */
export function kuwaitDayString(at: Date | number): string {
  const shifted = new Date((typeof at === "number" ? at : at.getTime()) + KUWAIT_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Midpoint-free parse: `YYYY-MM-DD` to the UTC instant of that Kuwait midnight. */
export function kuwaitDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map((part) => Number(part));
  return new Date(Date.UTC(y, m - 1, d) - KUWAIT_OFFSET_MS);
}

/** Exclusive end of a Kuwait day, i.e. the next day's 00:00 Kuwait. */
export function kuwaitDayEnd(day: string): Date {
  return new Date(kuwaitDayStart(day).getTime() + DAY_MS);
}

/**
 * The 05:00-to-05:00 operational day a Kuwait instant belongs to.
 *
 * Only the Orders Report and `deliveries.shift_date` use this. Everything else —
 * attendance, earnings, counts — is on the plain Kuwait calendar day, and mixing
 * the two would move four orders a night into the wrong day on every screen.
 */
export function operationalDayString(at: Date | number): string {
  const ts = typeof at === "number" ? at : at.getTime();
  return kuwaitDayString(ts - OPERATIONAL_DAY_START_HOUR * 60 * 60 * 1000);
}

/** Inclusive list of Kuwait days between two `YYYY-MM-DD` strings. */
export function kuwaitDayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = kuwaitDayStart(from).getTime();
  const end = kuwaitDayStart(to).getTime();
  if (end < cursor) return out;
  while (cursor <= end) {
    out.push(kuwaitDayString(cursor));
    cursor += DAY_MS;
  }
  return out;
}

/** Days in a `YYYY-MM` month, as the payroll snapshot reports it. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split("-").map((part) => Number(part));
  return { year: y, month: m };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

/** Mon YYYY, matching `to_char(m, 'Mon YYYY')` in the snapshot RPC. */
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

/** The month key and month sequence for the payroll 3-month picker. */
export function payrollMonths(today: Date, count = 3): Array<{
  key: string;
  year: number;
  month: number;
  days: number;
  label: string;
}> {
  const current = parseMonthKey(kuwaitDayString(today).slice(0, 7));
  const out: Array<{ key: string; year: number; month: number; days: number; label: string }> = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const monthIndex = current.year * 12 + (current.month - 1) - back;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    out.push({
      key: monthKey(year, month),
      year,
      month,
      days: daysInMonth(year, month),
      label: monthLabel(year, month),
    });
  }
  return out.reverse();
}
