export type AutoCheckoutReason =
  | "auto_offline"
  | "auto_out_of_zone"
  | "auto_shift_end";

export type AutoCheckoutDecisionInput = {
  isOnDuty: boolean;
  hasOpenAttendanceLog: boolean;
  /** ISO or null — session offline start; null means currently online / no offline clock */
  wentOfflineAt: string | null;
  /** ISO or null — continuous out-of-zone start; null means in zone / reset */
  outOfZoneSince: string | null;
  /** ISO — scheduled end of the open log's shift */
  shiftEndAt?: string | null;
  /** Open attendance log date (YYYY-MM-DD, Asia/Kuwait) */
  logDate?: string | null;
  /** Today in Asia/Kuwait (YYYY-MM-DD) */
  todayDate?: string | null;
  thresholdMinutes: number;
  nowMs?: number;
};

export type AutoCheckoutDecision =
  | { shouldCheckout: false }
  | { shouldCheckout: true; reason: AutoCheckoutReason };

function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return null;
  return (nowMs - start) / 60_000;
}

/**
 * Shift end / leftover duty wins, then 45-minute (configurable) offline
 * OR out-of-zone. Returning online / in-zone clears that timer.
 * Offline preferred when both duration thresholds are met.
 */
export function decideAutoCheckout(
  input: AutoCheckoutDecisionInput,
): AutoCheckoutDecision {
  if (!input.isOnDuty) {
    return { shouldCheckout: false };
  }

  if (!input.hasOpenAttendanceLog) {
    return { shouldCheckout: true, reason: "auto_shift_end" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const shiftEndMs = input.shiftEndAt ? Date.parse(input.shiftEndAt) : NaN;
  if (Number.isFinite(shiftEndMs) && nowMs >= shiftEndMs) {
    return { shouldCheckout: true, reason: "auto_shift_end" };
  }

  if (
    input.logDate &&
    input.todayDate &&
    input.logDate < input.todayDate
  ) {
    return { shouldCheckout: true, reason: "auto_shift_end" };
  }

  const threshold = Math.max(1, input.thresholdMinutes);
  const offlineMinutes = minutesSince(input.wentOfflineAt, nowMs);
  if (offlineMinutes != null && offlineMinutes >= threshold) {
    return { shouldCheckout: true, reason: "auto_offline" };
  }

  const outMinutes = minutesSince(input.outOfZoneSince, nowMs);
  if (outMinutes != null && outMinutes >= threshold) {
    return { shouldCheckout: true, reason: "auto_out_of_zone" };
  }

  return { shouldCheckout: false };
}

export function isAutoCheckoutReason(
  reason: string | null | undefined,
): reason is AutoCheckoutReason {
  return (
    reason === "auto_offline" ||
    reason === "auto_out_of_zone" ||
    reason === "auto_shift_end"
  );
}

/** Zone transition helper: set/clear out_of_zone_since. */
export function nextOutOfZoneSince(input: {
  previousZoneStatus: string | null | undefined;
  previousOutOfZoneSince: string | null | undefined;
  nextZoneStatus: string | null | undefined;
  nowIso: string;
}): string | null {
  const next = input.nextZoneStatus ?? null;
  if (next === "out_of_zone") {
    if (input.previousOutOfZoneSince) return input.previousOutOfZoneSince;
    if (input.previousZoneStatus === "out_of_zone" && input.previousOutOfZoneSince) {
      return input.previousOutOfZoneSince;
    }
    return input.nowIso;
  }
  return null;
}
