-- Driver mobile app branding + maintenance (separate from admin panel branding).

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_title text NOT NULL DEFAULT 'Musallam Delivery',
  ADD COLUMN IF NOT EXISTS driver_app_logo_url text,
  ADD COLUMN IF NOT EXISTS driver_app_splash_url text,
  ADD COLUMN IF NOT EXISTS driver_app_maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_app_maintenance_message text NOT NULL DEFAULT
    'The driver app is temporarily unavailable. Please try again later.';

COMMENT ON COLUMN public.app_settings.driver_app_title IS
  'Driver mobile app title (separate from admin app_name).';
COMMENT ON COLUMN public.app_settings.driver_app_logo_url IS
  'Public URL to driver app logo (branding/driver-app/logo.*).';
COMMENT ON COLUMN public.app_settings.driver_app_splash_url IS
  'Public URL to driver app splash screen image (branding/driver-app/splash.*).';
COMMENT ON COLUMN public.app_settings.driver_app_maintenance_mode IS
  'When true, the driver mobile app should render a maintenance screen.';
COMMENT ON COLUMN public.app_settings.driver_app_maintenance_message IS
  'Message the driver app shows when in maintenance.';

-- Splash assets may exceed the original 2 MiB logo cap.
UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id = 'branding';
