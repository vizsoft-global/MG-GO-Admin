import { formatSessionRange, type ShiftRow } from "@/features/driver-tracking/shift-flags";

export type VehicleDutyShift = Pick<
  ShiftRow,
  | "shift_date"
  | "shift_type"
  | "session1_start"
  | "session1_end"
  | "session1_end_day_offset"
  | "session2_start"
  | "session2_end"
  | "session2_start_day_offset"
  | "session2_end_day_offset"
>;

/**
 * On Duty is an attendance fact, not a shift-window guess.
 *
 * It used to also require the rider's shift window to contain `now`, so an early
 * clock-in, a split shift between sessions, or an overnight shift that started
 * yesterday read Off Duty on the fleet list while `/attendance` said On Duty for
 * the same rider at the same moment (QA #35). The open attendance row is the
 * authority: `check_out_at IS NULL` means the rider has not clocked out.
 *
 * The shift window is deliberately *not* consulted here. It is annotation on the
 * vehicle card (which shift a rider is on, and when it ends) and nothing else —
 * "no shift row at all" has never meant off duty, and a clocked-in rider with no
 * published shift is still working.
 */
export function vehicleAssignedOnDuty(input: {
  assignedDriverId: string | null | undefined;
  hasOpenAttendance: boolean;
}): boolean {
  return Boolean(input.assignedDriverId) && input.hasOpenAttendance;
}

export function vehicleIsUnderRepair(row: {
  status: string | null | undefined;
  condition: string | null | undefined;
}): boolean {
  return row.condition === "repair_required" || row.status === "maintenance";
}

/**
 * The rider's current shift as text, e.g. `10:00–14:00` or `10:00–14:00, 17:00–20:00`.
 * Annotation only — it never decides On Duty — and built from the row's own time
 * strings, so an ISO format would have been the only thing introducing a timezone
 * difference between the server render and the browser.
 */
export function vehicleShiftLabel(shift: VehicleDutyShift | null | undefined): string | null {
  if (!shift) return null;
  const first = formatSessionRange(
    shift.session1_start,
    shift.session1_end,
    shift.session1_end_day_offset,
  );
  if (shift.shift_type !== "split" || !shift.session2_start || !shift.session2_end) return first;
  const second = formatSessionRange(
    shift.session2_start,
    shift.session2_end,
    shift.session2_end_day_offset ?? 0,
  );
  return `${first}, ${second}`;
}
