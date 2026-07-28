export const KUWAIT_TZ = "Asia/Kuwait";

export function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function kuwaitDateFromIso(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date(iso));
}

/** Kuwait calendar day bounds as ISO strings (+03:00). */
export function kuwaitDayBounds(date: string): { from: string; to: string } {
  return {
    from: `${date}T00:00:00+03:00`,
    to: `${date}T23:59:59.999+03:00`,
  };
}

export function formatTimeHm(time: string): string {
  const parts = time.split(":");
  if (parts.length < 2) return time;
  return `${parts[0]}:${parts[1]}`;
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function logDurationSeconds(
  checkIn: string | null,
  checkOut: string | null,
): number | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (ms <= 0) return null;
  return Math.floor(ms / 1000);
}
