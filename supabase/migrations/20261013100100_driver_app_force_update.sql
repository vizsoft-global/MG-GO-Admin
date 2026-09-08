-- Driver app force-update controls (admin-driven Play Store gate).
--
-- The driver app has no OTA channel any more (sideload was removed 2026-08-04), so
-- the only way to get a fleet off a build that is hurting production is the Play
-- Store. This gives the panel a switch: when driver_app_force_update is on, any build
-- whose Android versionCode is below driver_app_min_version_code is shown a
-- non-dismissible "Update required" screen that deep-links to the Play listing, and
-- driver-passcode-login refuses to mint a session for it.
--
-- Read by the app through the existing anon policy on app_settings id = 1, the same
-- way maintenance mode is, so the gate works before login.
--
-- min_version_code is the versionCode the operator published — there is no Play
-- Developer API lookup. Nullable so the toggle can be prepared before the number is
-- known; the app treats a null minimum as "no gate" even when the toggle is on.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_force_update boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_app_min_version_code integer,
  ADD COLUMN IF NOT EXISTS driver_app_min_version_name text,
  ADD COLUMN IF NOT EXISTS driver_app_update_message text;

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_driver_app_min_version_code_check;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_driver_app_min_version_code_check
  CHECK (driver_app_min_version_code IS NULL OR driver_app_min_version_code > 0);

COMMENT ON COLUMN public.app_settings.driver_app_force_update IS
  'When true, driver builds with versionCode < driver_app_min_version_code are blocked until they update from the Play Store.';
COMMENT ON COLUMN public.app_settings.driver_app_min_version_code IS
  'Android versionCode of the oldest build allowed while driver_app_force_update is on.';
COMMENT ON COLUMN public.app_settings.driver_app_min_version_name IS
  'Display-only versionName shown on the Update required screen (e.g. 1.1.21).';
COMMENT ON COLUMN public.app_settings.driver_app_update_message IS
  'Optional copy for the Update required screen; the app falls back to its own string when null.';
