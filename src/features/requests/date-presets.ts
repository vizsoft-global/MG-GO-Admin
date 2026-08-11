import type { RequestDatePreset } from "./types";

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitDateParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, day };
}

/** Inclusive Kuwait calendar window → UTC bounds for created_at filter. */
export function datePresetToBounds(preset: RequestDatePreset): {
  from: string | null;
  to: string | null;
} {
  if (preset === "all") return { from: null, to: null };
  const { y, m, day } = kuwaitDateParts();
  const startOfDay = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0) - 3 * 3600 * 1000);
  const addDays = (base: Date, n: number) =>
    new Date(base.getTime() + n * 24 * 3600 * 1000);

  if (preset === "today") {
    const from = startOfDay(y, m, day);
    return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
  }
  if (preset === "this_week") {
    const today = startOfDay(y, m, day);
    const dow = new Date(Date.UTC(y, m - 1, day, 12, 0, 0)).getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = addDays(today, mondayOffset);
    return { from: from.toISOString(), to: addDays(from, 7).toISOString() };
  }
  if (preset === "this_month") {
    const from = startOfDay(y, m, 1);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return {
      from: from.toISOString(),
      to: startOfDay(nextY, nextM, 1).toISOString(),
    };
  }
  const lm = m === 1 ? 12 : m - 1;
  const ly = m === 1 ? y - 1 : y;
  const from = startOfDay(ly, lm, 1);
  return { from: from.toISOString(), to: startOfDay(y, m, 1).toISOString() };
}
