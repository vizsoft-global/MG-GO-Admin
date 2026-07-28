import type { ShiftAdherence } from "@/features/driver-tracking/shift-adherence";

export const ATTENDANCE_STATUSES = [
  "present",
  "late",
  "absent",
  "on_leave",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceTabFilter = "live" | "logs" | "exceptions";

export type AttendanceListRow = {
  id: string | null;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  driver_phone: string;
  log_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  distance_meters: number | null;
  status: AttendanceStatus;
  zone_compliance: "inside" | "outside" | null;
  admin_note: string | null;
  is_on_duty: boolean;
  is_active_now: boolean;
  is_exception: boolean;
  app_attendance_status: string | null;
  online_seconds_today: number | null;
  shift_adherence: ShiftAdherence | null;
  scheduled_shift_label: string | null;
};

export type AttendanceKpis = {
  present: number;
  late: number;
  absent: number;
  on_leave: number;
  active_now: number;
  outside_zone: number;
};

export type AttendanceCorrectionInput = {
  log_id?: string | null;
  driver_id: string;
  log_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: AttendanceStatus;
  note: string;
};

export type AttendanceActionError =
  | "not_authorized"
  | "note_required"
  | "missing_fields"
  | "invalid_times"
  | "future_date"
  | "log_not_found"
  | "driver_not_found"
  | "save_failed";
