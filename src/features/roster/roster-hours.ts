/** Scheduled length vs time actually online inside that window. */

export function rosterHours(input: {
  start: Date | null;
  end: Date | null;
  checkIn: Date | null;
  checkOut: Date | null;
  openUntil: Date | null;
}): { scheduled: number; worked: number } {
  if (!input.start || !input.end || input.end.getTime() <= input.start.getTime()) {
    return { scheduled: 0, worked: 0 };
  }
  const scheduled = Math.round((input.end.getTime() - input.start.getTime()) / 60_000);
  if (!input.checkIn) return { scheduled, worked: 0 };
  const out = input.checkOut ?? input.openUntil;
  if (!out) return { scheduled, worked: 0 };
  const from = Math.max(input.start.getTime(), input.checkIn.getTime());
  const to = Math.min(input.end.getTime(), out.getTime());
  const worked = to > from ? Math.round((to - from) / 60_000) : 0;
  return { scheduled, worked };
}
