const KUWAIT_TZ = "Asia/Kuwait";

export function formatKuwaitTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: KUWAIT_TZ,
  }).format(new Date(iso));
}

export function formatKuwaitDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: KUWAIT_TZ,
  }).format(new Date(iso));
}

export function formatScheduledShiftRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso || !endIso) return "—";
  return `${formatKuwaitTime(startIso)}–${formatKuwaitTime(endIso)}`;
}

export function formatVsScheduled(
  onlineSeconds: number,
  scheduledSeconds: number,
): string {
  if (scheduledSeconds <= 0) return "—";
  const pct = Math.round((onlineSeconds / scheduledSeconds) * 100);
  return `${pct}%`;
}

export function adherenceTooltip(adherence: {
  minutes_late: number;
  minutes_early_out: number;
  online_seconds: number;
}): string {
  const parts: string[] = [];
  if (adherence.minutes_late > 0) parts.push(`+${adherence.minutes_late}m late`);
  if (adherence.minutes_early_out > 0) parts.push(`−${adherence.minutes_early_out}m early out`);
  if (parts.length === 0) parts.push("On time");
  return parts.join(" · ");
}
