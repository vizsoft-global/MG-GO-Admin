/**
 * Mirrors the non-midnight branch of `report_delivery_orders`.
 * When From time is 00:00 the SQL keeps the existing shift attribution.
 */

export function isOperationalDayMode(fromTime: string): boolean {
  return normalizeTime(fromTime) !== "00:00:00";
}

export function exclusiveReportEnd(fromTime: string, toTime: string): boolean {
  return isOperationalDayMode(fromTime) && normalizeTime(fromTime) === normalizeTime(toTime);
}

export function operationalAttributedDate(kuwaitWallIso: string, fromTime: string): string {
  const wall = Date.parse(kuwaitWallIso.endsWith("Z") ? kuwaitWallIso : `${kuwaitWallIso}Z`);
  if (Number.isNaN(wall)) throw new Error("invalid_wall");
  const [hour, minute, second] = normalizeTime(fromTime).split(":").map(Number);
  const shifted = wall - ((hour ?? 0) * 3600 + (minute ?? 0) * 60 + (second ?? 0)) * 1000;
  const d = new Date(shifted);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function reportColumnRange(
  from: string,
  to: string,
  fromTime: string,
  toTime: string,
): { first: string; last: string } {
  if (normalizeTime(toTime) <= normalizeTime(fromTime) && to > from) {
    return { first: from, last: addDays(to, -1) };
  }
  return { first: from, last: to };
}

export function clampAttributedDate(date: string, first: string, last: string): string {
  if (date < first) return first;
  if (date > last) return last;
  return date;
}

export function inReportWindow(
  atMs: number,
  fromMs: number,
  toMs: number,
  exclusiveEnd: boolean,
): boolean {
  return exclusiveEnd ? atMs >= fromMs && atMs < toMs : atMs >= fromMs && atMs <= toMs;
}

function normalizeTime(value: string): string {
  const parts = value.split(":");
  const hour = Number(parts[0] ?? 0);
  const minute = Number(parts[1] ?? 0);
  const second = Number(parts[2] ?? 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
