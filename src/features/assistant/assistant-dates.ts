import { addDays, kuwaitToday } from "@/features/performance/performance-formulas";

export const ASSISTANT_DATE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
] as const;

export type AssistantDatePreset = (typeof ASSISTANT_DATE_PRESETS)[number];

export const ASSISTANT_MAX_RANGE_DAYS = 400;

export function isAssistantDatePreset(value: string): value is AssistantDatePreset {
  return (ASSISTANT_DATE_PRESETS as readonly string[]).includes(value);
}

/** Saturday of the Kuwait week that contains `ymd` (YYYY-MM-DD). */
export function kuwaitWeekStartSaturday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const satOffset = (dow + 1) % 7;
  return addDays(ymd, -satOffset);
}

export function inclusiveDayCount(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00+03:00`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00+03:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function lastMonthRange(today: string): { from: string; to: string } {
  const [y, mo] = today.split("-").map(Number);
  const prevMo = mo === 1 ? 12 : mo - 1;
  const prevY = mo === 1 ? y - 1 : y;
  const lastDay = new Date(Date.UTC(prevY, prevMo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${prevY}-${pad(prevMo)}-01`,
    to: `${prevY}-${pad(prevMo)}-${pad(lastDay)}`,
  };
}

export function lastWeekRange(today: string): { from: string; to: string } {
  const thisSat = kuwaitWeekStartSaturday(today);
  return { from: addDays(thisSat, -7), to: addDays(thisSat, -1) };
}

function presetRange(preset: AssistantDatePreset, today: string): { from: string; to: string } {
  const [y, mo] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yday = addDays(today, -1);
      return { from: yday, to: yday };
    }
    case "this_week":
      return { from: kuwaitWeekStartSaturday(today), to: today };
    case "last_week":
      return lastWeekRange(today);
    case "this_month":
      return { from: `${y}-${pad(mo)}-01`, to: today };
    case "last_month":
      return lastMonthRange(today);
  }
}

/**
 * Resolve a preset or explicit from/to to inclusive Kuwait calendar days.
 * A valid preset always wins — models often invent a stale from/to beside it.
 * "This month" and "this week" end today — do not claim days that have not happened.
 */
export function resolveAssistantDateRange(
  input: { preset?: string | null; from?: string | null; to?: string | null },
  today = kuwaitToday(),
): { from: string; to: string } {
  const preset = input.preset && isAssistantDatePreset(input.preset) ? input.preset : null;
  const range = preset
    ? presetRange(preset, today)
    : explicitRange(input, today);
  if (inclusiveDayCount(range.from, range.to) > ASSISTANT_MAX_RANGE_DAYS) {
    throw new Error("range_too_large");
  }
  return range;
}

function explicitRange(
  input: { from?: string | null; to?: string | null },
  today: string,
): { from: string; to: string } {
  const explicitFrom = input.from?.slice(0, 10) || "";
  const explicitTo = input.to?.slice(0, 10) || "";
  if (explicitFrom && explicitTo) {
    if (explicitTo < explicitFrom) throw new Error("invalid_date_range");
    return { from: explicitFrom, to: explicitTo };
  }
  if (explicitFrom && !explicitTo) return { from: explicitFrom, to: today };
  if (!explicitFrom && explicitTo) return { from: explicitTo, to: explicitTo };
  return presetRange("today", today);
}

/** Live snapshot date: missing / future / older than 400 days → Kuwait today. */
export function resolveAssistantLiveDate(date?: string | null, today = kuwaitToday()): string {
  const ymd = date?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return today;
  if (ymd > today) return today;
  if (ymd < addDays(today, -400)) return today;
  return ymd;
}

/** Inclusive created_at bounds matching the deliveries list date filter. */
export function kuwaitDayCreatedAtBounds(from: string, to: string): {
  dateFrom: string;
  dateTo: string;
} {
  return {
    dateFrom: `${from.slice(0, 10)}T00:00:00.000+03:00`,
    dateTo: `${to.slice(0, 10)}T23:59:59.999+03:00`,
  };
}

export function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}
