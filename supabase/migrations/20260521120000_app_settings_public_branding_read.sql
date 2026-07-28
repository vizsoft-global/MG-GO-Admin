-- Allow unauthenticated pages (login, signup, maintenance) to read branding from app_settings.

DROP POLICY IF EXISTS app_settings_public_branding_read ON public.app_settings;
CREATE POLICY app_settings_public_branding_read ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (id = 1);
