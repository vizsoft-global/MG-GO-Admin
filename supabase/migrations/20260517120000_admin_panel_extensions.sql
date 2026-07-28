-- Admin panel extensions (applied to DPD Supabase project)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_locale_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('en', 'ar'));

CREATE TABLE IF NOT EXISTS public.admin_allowlist (
  email text PRIMARY KEY,
  role public.app_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin_panel_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'staff'::public.app_role
      AND p.archived_at IS NULL
  );
$$;
