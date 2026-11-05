import { DEFAULT_TIMEZONE } from "./constants";

const KUWAIT_OFFSET = "+03:00";

/** Kuwait calendar day (`YYYY-MM-DD`) for an instant, default now. */
export function kuwaitTodayString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE }).format(at);
}

export type CampaignDateBounds = {
  fromIso?: string;
  toIso?: string;
  fromDate?: string;
  toDate?: string;
};

/**
 * Converts `YYYY-MM-DD` picker values into Kuwait (+03:00) day bounds with
 * millisecond precision, so a row stored at `23:59:59.500Z` on the last picked
 * day is still inside the range. Inverted input is swapped rather than
 * returning nothing.
 */
export function campaignDateBounds(fromDate?: string, toDate?: string): CampaignDateBounds {
  let from = normaliseDay(fromDate);
  let to = normaliseDay(toDate);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    fromIso: from ? new Date(`${from}T00:00:00.000${KUWAIT_OFFSET}`).toISOString() : undefined,
    toIso: to ? new Date(`${to}T23:59:59.999${KUWAIT_OFFSET}`).toISOString() : undefined,
    fromDate: from,
    toDate: to,
  };
}

/** Kuwait day bounds for a single calendar day, defaulting to today. */
export function campaignDayBounds(day?: string): CampaignDateBounds {
  const target = normaliseDay(day) ?? kuwaitTodayString();
  return campaignDateBounds(target, target);
}

function normaliseDay(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}
