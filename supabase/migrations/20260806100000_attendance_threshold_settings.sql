-- Attendance threshold settings (additive columns on app_settings).

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS attendance_late_grace_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS attendance_early_out_grace_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS attendance_offline_alert_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS attendance_gps_stale_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS attendance_gps_min_accuracy_meters integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.app_settings.attendance_late_grace_minutes IS
  'Minutes after scheduled shift start before check-in counts as late.';
COMMENT ON COLUMN public.app_settings.attendance_early_out_grace_minutes IS
  'Grace minutes before early checkout counts as early out.';
COMMENT ON COLUMN public.app_settings.attendance_offline_alert_minutes IS
  'Minutes offline during an active shift before exception.';
COMMENT ON COLUMN public.app_settings.attendance_gps_stale_minutes IS
  'No location update this long while on duty = missing updates.';
COMMENT ON COLUMN public.app_settings.attendance_gps_min_accuracy_meters IS
  'GPS pings worse than this count as bad accuracy.';
