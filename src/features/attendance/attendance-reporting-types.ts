export type AttendanceHubTab = "today" | "history" | "problems" | "analytics";

export type AttendanceSortKey =
  | "problems_first"
  | "name_asc"
  | "name_desc"
  | "last_seen"
  | "date_desc"
  | "date_asc";

export type AttendanceListFilters = {
  search?: string;
  partnerId?: string;
  zoneId?: string;
  restaurantId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  liveOnly?: boolean;
  sort?: AttendanceSortKey;
  page?: number;
  pageSize?: number;
};

export type AttendanceDailyRow = {
  driver_id: string;
  log_date: string;
  driver_code: string;
  employee_id: string | null;
  driver_name: string;
  driver_phone: string;
  partner_id: string | null;
  partner_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  is_on_duty: boolean;
  shift_type: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  attendance_log_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  attendance_status: string;
  online_seconds: number;
  duty_seconds: number;
  minutes_late: number;
  minutes_early_out: number;
  last_seen_at: string | null;
  gps_zone_status: string | null;
  gps_accuracy_meters: number | null;
  gps_is_mocked: boolean | null;
  live_status: string;
  compliance_score: number | null;
};

export type AttendanceReportingKpis = {
  scheduled: number;
  checked_in: number;
  late: number;
  absent: number;
  online: number;
  problems: number;
  compliance_score: number;
};

export type AttendanceExceptionRow = {
  exception_key: string;
  driver_id: string;
  exception_date: string;
  exception_type: string;
  severity: string;
  detected_at: string | null;
  duration_seconds: number | null;
  driver_name: string;
  driver_code: string;
  employee_id: string | null;
  partner_name: string | null;
  zone_name: string | null;
  current_status: string;
  resolution_status: string | null;
  supervisor_action: string | null;
  supervisor_note: string | null;
  supervisor_id: string | null;
};

export type AttendanceThresholdSettings = {
  attendance_late_grace_minutes: number;
  attendance_early_out_grace_minutes: number;
  attendance_offline_alert_minutes: number;
  attendance_gps_stale_minutes: number;
  attendance_gps_min_accuracy_meters: number;
};

export type ExceptionResolutionStatus = "open" | "acknowledged" | "resolved";
