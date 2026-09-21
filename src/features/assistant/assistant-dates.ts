import { addDays, kuwaitToday } from "@/features/performance/performance-formulas";

export const ASSISTANT_DATE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
] as const;

export type AssistantDatePreset = (typeof ASSISTANT_DATE_PRESETS)[number];

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

/**
 * Resolve a preset or explicit from/to to inclusive Kuwait calendar days.
 * "This month" and "this week" end today — do not claim days that have not happened.
 */
export function resolveAssistantDateRange(
  input: { preset?: string | null; from?: string | null; to?: string | null },
  today = kuwaitToday(),
): { from: string; to: string } {
  const explicitFrom = input.from?.slice(0, 10) || "";
  const explicitTo = input.to?.slice(0, 10) || "";
  if (explicitFrom && explicitTo) {
    if (explicitTo < explicitFrom) throw new Error("invalid_date_range");
    return { from: explicitFrom, to: explicitTo };
  }
  if (explicitFrom && !explicitTo) return { from: explicitFrom, to: today };
  if (!explicitFrom && explicitTo) return { from: explicitTo, to: explicitTo };

  const preset = input.preset && isAssistantDatePreset(input.preset) ? input.preset : "today";
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
    case "this_month":
      return { from: `${y}-${pad(mo)}-01`, to: today };
  }
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
