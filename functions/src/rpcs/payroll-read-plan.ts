export const PAYROLL_ATTENDANCE_FIELDS = [
  "driver_id",
  "log_date",
  "worked_minutes",
  "check_in_at",
  "check_out_at",
] as const;

export const PAYROLL_RECON_FIELDS = [
  "employee_id",
  "work_date",
  "run_id",
  "excel_orders",
] as const;

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
}

/** Closed-log hours. An open log stays 0 so the rule engine does not credit a shift that has not ended. */
export function payrollHoursFromFields(raw: Record<string, unknown>): number {
  const minutes = raw["worked_minutes"];
  if (typeof minutes === "number" && Number.isFinite(minutes)) return minutes / 60;
  const checkIn = asDate(raw["check_in_at"]);
  const checkOut = asDate(raw["check_out_at"]);
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000);
}
