-- Upload audit log + remove DB-stored R2 credentials (use Vercel env R2_* only).

CREATE TABLE IF NOT EXISTS public.storage_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  bucket text NOT NULL,
  size_bytes bigint,
  content_type text,
  entity_type text,
  entity_id text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_via text NOT NULL DEFAULT 'admin'
    CHECK (uploaded_via IN ('admin', 'driver_presigned', 'driver_proxy')),
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  expires_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS storage_uploads_uploaded_at_idx
  ON public.storage_uploads (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS storage_uploads_uploaded_by_idx
  ON public.storage_uploads (uploaded_by, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS storage_uploads_pending_expires_idx
  ON public.storage_uploads (status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS storage_uploads_entity_idx
  ON public.storage_uploads (entity_type, entity_id)
  WHERE status = 'completed';

COMMENT ON TABLE public.storage_uploads IS
  'Audit log for R2 object uploads (admin panel + driver app). Credentials live in env vars only.';

ALTER TABLE public.storage_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_uploads_super_admin_select ON public.storage_uploads;
CREATE POLICY storage_uploads_super_admin_select ON public.storage_uploads
  FOR SELECT TO authenticated
  USING (public.is_super_admin_user());

DROP POLICY IF EXISTS storage_uploads_rider_own_select ON public.storage_uploads;
CREATE POLICY storage_uploads_rider_own_select ON public.storage_uploads
  FOR SELECT TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'rider'::public.app_role
    )
  );

DROP TABLE IF EXISTS public.storage_config;
