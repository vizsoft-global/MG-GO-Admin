import { addKuwaitDays, kuwaitSatFriWeek } from "@/lib/date/kuwait-dates";

export const FUEL_RANGE_MAX_DAYS = 31;

export type FuelRangeMode = "daily" | "weekly" | "monthly" | "custom";

export type FuelRange = {
  start: string;
  end: string;
  days: string[];
};

/** Inclusive Kuwait dates. `null` when `to` is before `from` or the span exceeds 31 days. */
export function inclusiveKuwaitDays(from: string, to: string): string[] | null {
  if (to < from) return null;
  const days: string[] = [];
  let cursor = from;
  for (;;) {
    days.push(cursor);
    if (cursor === to) return days;
    if (days.length === FUEL_RANGE_MAX_DAYS) return null;
    cursor = addKuwaitDays(cursor, 1);
  }
}

export function kuwaitMonthRange(ymd: string): FuelRange {
  const prefix = ymd.slice(0, 7);
  const start = `${prefix}-01`;
  const days: string[] = [];
  let cursor = start;
  while (cursor.startsWith(prefix)) {
    days.push(cursor);
    cursor = addKuwaitDays(cursor, 1);
  }
  const end = days[days.length - 1] ?? start;
  return { start, end, days };
}

export function shiftFuelAnchor(mode: Exclude<FuelRangeMode, "custom">, anchor: string, direction: -1 | 1): string {
  if (mode === "daily") return addKuwaitDays(anchor, direction);
  if (mode === "weekly") return addKuwaitDays(kuwaitSatFriWeek(anchor).start, direction * 7);
  const month = kuwaitMonthRange(anchor);
  return addKuwaitDays(direction < 0 ? month.start : month.end, direction);
}

export function resolveFuelRange(input: {
  mode: FuelRangeMode;
  anchor: string;
  customFrom: string;
  customTo: string;
}): { ok: true; range: FuelRange } | { ok: false; reason: "order" | "span" } {
  if (input.mode === "daily") {
    return { ok: true, range: { start: input.anchor, end: input.anchor, days: [input.anchor] } };
  }
  if (input.mode === "weekly") {
    return { ok: true, range: kuwaitSatFriWeek(input.anchor) };
  }
  if (input.mode === "monthly") {
    return { ok: true, range: kuwaitMonthRange(input.anchor) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.customTo)) {
    return { ok: false, reason: "order" };
  }
  if (input.customTo < input.customFrom) return { ok: false, reason: "order" };
  const days = inclusiveKuwaitDays(input.customFrom, input.customTo);
  if (!days) return { ok: false, reason: "span" };
  const start = days[0] ?? input.customFrom;
  const end = days[days.length - 1] ?? input.customTo;
  return { ok: true, range: { start, end, days } };
}
