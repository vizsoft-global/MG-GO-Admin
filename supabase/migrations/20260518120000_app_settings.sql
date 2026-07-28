-- Global admin panel branding settings (singleton row)

CREATE TABLE IF NOT EXISTS public.app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name text NOT NULL DEFAULT 'DPD Admin',
  app_subtitle text NOT NULL DEFAULT 'Delivery Panel',
  font_family text NOT NULL DEFAULT 'inter',
  logo_url text,
  logo_type text NOT NULL DEFAULT 'image' CHECK (logo_type IN ('image', 'svg')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.app_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_staff_read ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE POLICY app_settings_staff_write ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- Branding assets bucket (create in dashboard if migration cannot create buckets)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY branding_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'branding');

CREATE POLICY branding_staff_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'branding' AND public.is_admin_panel_user())
  WITH CHECK (bucket_id = 'branding' AND public.is_admin_panel_user());
