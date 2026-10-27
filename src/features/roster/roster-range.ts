import { addDays } from "@/features/driver-tracking/kuwait-time";

export type RosterRangePreset = "today" | "yesterday" | "last7" | "thisWeek" | "lastWeek" | "custom";

/** Kuwait week is Saturday–Friday. */
export function kuwaitWeekStart(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const back = (dow + 1) % 7;
  return addDays(date, -back);
}

export function daysInRange(from: string, to: string, cap = 31): string[] {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end && days.length < cap) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function rangeForPreset(
  preset: RosterRangePreset,
  today: string,
  customFrom?: string,
  customTo?: string,
): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "thisWeek": {
      const start = kuwaitWeekStart(today);
      return { from: start, to: addDays(start, 6) };
    }
    case "lastWeek": {
      const start = addDays(kuwaitWeekStart(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case "custom": {
      const from = customFrom || today;
      const to = customTo || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default: {
      const _never: never = preset;
      return _never;
    }
  }
}

export function formatRangeLabel(from: string, to: string, locale: string): string {
  const tag = locale.startsWith("ar") ? "ar" : "en-GB";
  const parts = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    return {
      day: date.getUTCDate(),
      month: date.toLocaleString(tag, { month: "short", timeZone: "UTC" }),
      year: date.getUTCFullYear(),
      monthIndex: date.getUTCMonth(),
    };
  };
  const start = parts(from);
  const end = parts(to);
  if (from === to) return `${start.day} ${start.month} ${start.year}`;
  if (start.monthIndex === end.monthIndex && start.year === end.year) {
    return `${start.day}–${end.day} ${start.month} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${start.month}–${end.day} ${end.month} ${start.year}`;
  }
  return `${start.day} ${start.month} ${start.year}–${end.day} ${end.month} ${end.year}`;
}

export function weekdayShort(date: string, locale: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const tag = locale.startsWith("ar") ? "ar" : "en-GB";
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(tag, {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function formatDayLabel(ymd: string, locale: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const tag = locale.startsWith("ar") ? "ar" : "en-GB";
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(tag, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function clock12(hms: string | null): string {
  if (!hms) return "—";
  const [hours, minutes] = hms.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return hms;
  const am = hours < 12;
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}
