export type ShiftAdherence = {
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_in_at: string | null;
  actual_out_at: string | null;
  minutes_late: number;
  minutes_early_out: number;
  online_seconds: number;
  scheduled_seconds: number;
};

export function capShiftEarlyOutMinutes(
  minutes: number,
  scheduledSeconds: number,
): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(scheduledSeconds) || scheduledSeconds <= 0) {
    return Math.floor(minutes);
  }
  const cap = Math.floor(scheduledSeconds / 60);
  const value = Math.floor(minutes);
  return value > cap ? cap : value;
}

export function parseShiftAdherence(raw: unknown): ShiftAdherence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.scheduled_start_at !== "string" || typeof o.scheduled_end_at !== "string") {
    return null;
  }
  const scheduledSeconds = Number(o.scheduled_seconds ?? 0);
  return {
    scheduled_start_at: o.scheduled_start_at,
    scheduled_end_at: o.scheduled_end_at,
    actual_in_at: typeof o.actual_in_at === "string" ? o.actual_in_at : null,
    actual_out_at: typeof o.actual_out_at === "string" ? o.actual_out_at : null,
    minutes_late: Number(o.minutes_late ?? 0),
    minutes_early_out: capShiftEarlyOutMinutes(
      Number(o.minutes_early_out ?? 0),
      scheduledSeconds,
    ),
    online_seconds: Number(o.online_seconds ?? 0),
    scheduled_seconds: scheduledSeconds,
  };
}

export function adherenceMapKey(driverId: string, date: string): string {
  return `${driverId}:${date}`;
}
