-- Menu editor (per admin role) + locale management

CREATE TABLE IF NOT EXISTS public.menu_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'site')),
  site_id uuid,
  config jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS menu_configs_global_role_idx
  ON public.menu_configs (role)
  WHERE scope = 'global' AND site_id IS NULL;

ALTER TABLE public.menu_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menu_configs_read ON public.menu_configs;
CREATE POLICY menu_configs_read ON public.menu_configs
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS menu_configs_write ON public.menu_configs;
CREATE POLICY menu_configs_write ON public.menu_configs
  FOR ALL TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

CREATE TABLE IF NOT EXISTS public.locales (
  code text PRIMARY KEY,
  name text NOT NULL,
  native_name text NOT NULL,
  dir text NOT NULL DEFAULT 'ltr' CHECK (dir IN ('ltr', 'rtl')),
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locales_read ON public.locales;
CREATE POLICY locales_read ON public.locales
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS locales_write ON public.locales;
CREATE POLICY locales_write ON public.locales
  FOR ALL TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

INSERT INTO public.locales (code, name, native_name, dir, enabled, is_default) VALUES
  ('en', 'English', 'English', 'ltr', true, true),
  ('ar', 'Arabic', 'العربية', 'rtl', true, false)
ON CONFLICT (code) DO NOTHING;
