-- Home screen / launcher icon for the driver mobile app (separate from in-app logo).

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_icon_url text;

COMMENT ON COLUMN public.app_settings.driver_app_icon_url IS
  'Public URL to driver app home-screen icon (branding/driver-app/icon.*). Mobile app should refresh when this URL or updated_at changes.';
