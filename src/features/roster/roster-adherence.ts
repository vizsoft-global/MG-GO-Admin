/** Schedule vs actual login. OFF days never alert. */

export const DEFAULT_LATE_GRACE_MINUTES = 15;
export const DEFAULT_EARLY_GRACE_MINUTES = 10;

export type RosterDutyStatus =
  | "off"
  | "scheduled"
  | "not_logged_in"
  | "no_show"
  | "on_shift"
  | "late"
  | "logged_out_early";

export function rosterDutyStatus(input: {
  off: boolean;
  start: Date | null;
  end: Date | null;
  checkIn: Date | null;
  checkOut: Date | null;
  now: Date;
  lateGraceMin?: number;
  earlyGraceMin?: number;
}): { status: RosterDutyStatus; minutesLate: number; minutesEarly: number } {
  if (input.off || !input.start || !input.end) {
    return { status: "off", minutesLate: 0, minutesEarly: 0 };
  }
  const lateGrace = (input.lateGraceMin ?? DEFAULT_LATE_GRACE_MINUTES) * 60_000;
  const earlyGrace = (input.earlyGraceMin ?? DEFAULT_EARLY_GRACE_MINUTES) * 60_000;
  const minutesLate = input.checkIn
    ? Math.max(0, Math.round((input.checkIn.getTime() - input.start.getTime()) / 60_000))
    : 0;
  const minutesEarly = input.checkOut
    ? Math.max(0, Math.round((input.end.getTime() - input.checkOut.getTime()) / 60_000))
    : 0;

  if (input.now.getTime() < input.start.getTime() && !input.checkIn) {
    return { status: "scheduled", minutesLate: 0, minutesEarly: 0 };
  }
  if (!input.checkIn) {
    return {
      status: input.now.getTime() >= input.end.getTime() ? "no_show" : input.now.getTime() >= input.start.getTime() + lateGrace ? "not_logged_in" : "scheduled",
      minutesLate: 0,
      minutesEarly: 0,
    };
  }
  if (input.checkOut && input.checkOut.getTime() < input.end.getTime() - earlyGrace) {
    return { status: "logged_out_early", minutesLate, minutesEarly };
  }
  if (input.checkIn.getTime() > input.start.getTime() + lateGrace) {
    return { status: "late", minutesLate, minutesEarly: 0 };
  }
  return { status: "on_shift", minutesLate: 0, minutesEarly: 0 };
}
