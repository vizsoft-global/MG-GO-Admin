import { Timestamp } from "../core/fs";
import { FIELDS } from "../core/collections";
import { textOrNull, type Dict } from "./_shared";

const ATT = FIELDS.attendanceLogs;
const DRV = FIELDS.drivers;

export function attendanceDisplayName(
  profileFullName: unknown,
  driverName: unknown,
  driverCode: unknown,
): string | null {
  return textOrNull(profileFullName) ?? textOrNull(driverName) ?? textOrNull(driverCode);
}

export function attendanceIdentityMissing(existing: Dict): boolean {
  return (
    textOrNull(existing[ATT.driverName]) === null ||
    textOrNull(existing[ATT.driverCode]) === null ||
    textOrNull(existing[ATT.employeeId]) === null
  );
}

/** Denorm + duty flag written onto `attendance_logs` at clock-in / correction. */
export function stampAttendanceLogDenorm(input: {
  driver: Dict;
  profile?: Dict | null;
  isOnDuty: boolean;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
}): Dict {
  const driverCode = textOrNull(input.driver[DRV.driverCode]);
  const patch: Dict = {
    [ATT.driverName]: attendanceDisplayName(
      input.profile?.["full_name"],
      input.driver[DRV.name],
      driverCode,
    ),
    [ATT.driverCode]: driverCode,
    [ATT.employeeId]: textOrNull(input.driver[DRV.employeeId]),
    [ATT.isOnDuty]: input.isOnDuty,
  };
  if (input.scheduledStart) {
    patch[ATT.scheduledStartAt] = Timestamp.fromDate(input.scheduledStart);
  }
  if (input.scheduledEnd) {
    patch[ATT.scheduledEndAt] = Timestamp.fromDate(input.scheduledEnd);
  }
  return patch;
}

export function pickMissingAttendanceDenorm(existing: Dict, stamp: Dict): Dict {
  const out: Dict = {};
  for (const [key, value] of Object.entries(stamp)) {
    if (key === ATT.isOnDuty) continue;
    const current = existing[key];
    if (current == null || current === "") out[key] = value;
  }
  return out;
}
