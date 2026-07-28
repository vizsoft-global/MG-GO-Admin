-- Driver app login copy (readable by anon via app_settings_public_branding_read).

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_login_hint text NOT NULL DEFAULT 'Enter your ID and passcode from admin';

COMMENT ON COLUMN public.app_settings.driver_app_login_hint IS
  'Helper text on the driver mobile app login screen.';
