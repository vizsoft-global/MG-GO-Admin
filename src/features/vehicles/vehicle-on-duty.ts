import { computeShiftFlags, type ShiftRow } from "@/features/driver-tracking/shift-flags";

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

/** On Duty = assigned rider + open Kuwait attendance. Shift, if present, must contain now. */
export function vehicleAssignedOnDuty(input: {
  assignedDriverId: string | null | undefined;
  hasOpenAttendance: boolean;
  shift: VehicleDutyShift | null;
  nowMs?: number;
}): boolean {
  if (!input.assignedDriverId || !input.hasOpenAttendance) return false;
  if (!input.shift) return true;
  return computeShiftFlags(input.shift as ShiftRow, input.nowMs ?? Date.now()).isWithinWindow;
}

export function vehicleIsUnderRepair(row: {
  status: string | null | undefined;
  condition: string | null | undefined;
}): boolean {
  return row.condition === "repair_required" || row.status === "maintenance";
}
