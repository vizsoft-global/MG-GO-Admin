/** Wall-clock working seconds from check-in → check-out (midnight-safe). */
export function workingSeconds(
  checkInAt: string | null | undefined,
  checkOutAt: string | null | undefined,
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const inMs = Date.parse(checkInAt);
  const outMs = Date.parse(checkOutAt);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return null;
  if (outMs < inMs) return null;
  return Math.floor((outMs - inMs) / 1000);
}

/** Prefer reporting duty_seconds; fall back to check-in/out diff for closed logs. */
export function resolveWorkingSeconds(input: {
  dutySeconds?: number | null;
  checkInAt: string | null | undefined;
  checkOutAt: string | null | undefined;
}): number | null {
  if (input.checkOutAt == null) return null;
  if (
    typeof input.dutySeconds === "number" &&
    Number.isFinite(input.dutySeconds) &&
    input.dutySeconds >= 0
  ) {
    return Math.floor(input.dutySeconds);
  }
  return workingSeconds(input.checkInAt, input.checkOutAt);
}

export function formatWorkingHoursList(
  seconds: number | null,
  formatDuration: (s: number) => string,
): string {
  if (seconds == null) return "—";
  return formatDuration(seconds);
}
