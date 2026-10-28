import { formatPct } from "@/lib/format/percent";

const DASH = "\u2014";
const EN_DASH = "\u2013";

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function part(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuwait", ...options }).format(date);
}

/** `01 Nov 2026`. Missing or invalid values print an em dash. */
export function formatDisplayDate(value: Date | string | null | undefined): string {
  const date = asDate(value);
  if (!date) return DASH;
  const day = part(date, { day: "2-digit" });
  const month = part(date, { month: "short" });
  const year = part(date, { year: "numeric" });
  return `${day} ${month} ${year}`;
}

/** `26 Oct – 1 Nov`. A missing end prints the start date only. */
export function formatDisplayRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined,
): string {
  const start = formatDisplayDate(from);
  const end = formatDisplayDate(to);
  if (start === DASH && end === DASH) return DASH;
  if (end === DASH) return start;
  if (start === DASH) return end;
  const startShort = start.replace(/ \d{4}$/, "");
  const endShort = end.replace(/ \d{4}$/, "");
  return `${startShort} ${EN_DASH} ${endShort}`;
}

/** 24-hour `HH:mm` in Kuwait. */
export function formatDisplayTime(value: Date | string | null | undefined): string {
  const date = asDate(value);
  if (!date) return DASH;
  return part(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatDisplayPct(value: number | null | undefined): string {
  return formatPct(value);
}

export function displayOrDash(value: string | number | null | undefined): string {
  if (value == null) return DASH;
  const text = String(value).trim();
  return text.length === 0 ? DASH : text;
}
