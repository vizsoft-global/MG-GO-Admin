-- Cloudflare R2 credentials (super admin only; env vars take precedence at runtime)

CREATE TABLE IF NOT EXISTS public.storage_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  r2_account_id text,
  r2_access_key_id text,
  r2_secret_access_key text,
  r2_bucket_name text,
  r2_s3_endpoint text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.storage_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.storage_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_config_super_admin ON public.storage_config;
CREATE POLICY storage_config_super_admin ON public.storage_config
  FOR ALL TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

COMMENT ON TABLE public.storage_config IS
  'Singleton R2 API credentials; prefer Vercel env R2_* in production when set.';
