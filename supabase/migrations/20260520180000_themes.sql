-- Theme system: active theme on app_settings + custom themes table

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS theme_id text NOT NULL DEFAULT 'shopify';

CREATE TABLE IF NOT EXISTS public.app_themes (
  id text PRIMARY KEY,
  name text NOT NULL,
  base_preset text NOT NULL DEFAULT 'shopify',
  light_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  dark_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_themes_staff_read ON public.app_themes
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

CREATE POLICY app_themes_staff_write ON public.app_themes
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());
