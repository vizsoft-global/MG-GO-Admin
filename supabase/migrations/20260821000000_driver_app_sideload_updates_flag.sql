-- Global kill-switch for driver sideload OTA (Play Store review window).
-- Admin /app-releases stays usable; driver active-release returns null when false.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_sideload_updates_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.app_settings.driver_app_sideload_updates_enabled IS
  'When false, driver app must hide sideload OTA (Play Store review). Admin /app-releases still works.';
