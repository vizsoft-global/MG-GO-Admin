-- Android sideload app releases: admin uploads APKs to R2, marks one active per channel.

CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'android'
    CHECK (platform IN ('android')),
  channel text NOT NULL DEFAULT 'production'
    CHECK (channel IN ('production', 'beta', 'internal')),
  version_name text NOT NULL,
  version_code integer NOT NULL CHECK (version_code > 0),
  min_supported_version_code integer CHECK (min_supported_version_code IS NULL OR min_supported_version_code > 0),
  apk_object_key text NOT NULL,
  apk_size_bytes bigint NOT NULL CHECK (apk_size_bytes > 0),
  apk_sha256 text NOT NULL,
  release_notes text,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  released_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT app_releases_platform_channel_version_code_unique
    UNIQUE (platform, channel, version_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_releases_active_idx
  ON public.app_releases (platform, channel)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS app_releases_channel_released_at_idx
  ON public.app_releases (platform, channel, released_at DESC);

COMMENT ON TABLE public.app_releases IS
  'Android sideload APK releases. One active row per (platform, channel).';

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_releases_admin_select ON public.app_releases;
CREATE POLICY app_releases_admin_select ON public.app_releases
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS app_releases_super_admin_insert ON public.app_releases;
CREATE POLICY app_releases_super_admin_insert ON public.app_releases
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin_user());

DROP POLICY IF EXISTS app_releases_super_admin_update ON public.app_releases;
CREATE POLICY app_releases_super_admin_update ON public.app_releases
  FOR UPDATE TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

DROP POLICY IF EXISTS app_releases_super_admin_delete ON public.app_releases;
CREATE POLICY app_releases_super_admin_delete ON public.app_releases
  FOR DELETE TO authenticated
  USING (public.is_super_admin_user());

-- Returns active release metadata for authenticated riders (no presigned URL — added by admin API).
CREATE OR REPLACE FUNCTION public.driver_get_active_app_release(
  p_platform text DEFAULT 'android',
  p_channel text DEFAULT 'production'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.app_releases%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_channel NOT IN ('production', 'beta', 'internal') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;

  SELECT *
  INTO v_row
  FROM public.app_releases r
  WHERE r.platform = p_platform
    AND r.channel = p_channel
    AND r.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'version_name', v_row.version_name,
    'version_code', v_row.version_code,
    'min_supported_version_code', v_row.min_supported_version_code,
    'apk_object_key', v_row.apk_object_key,
    'apk_size_bytes', v_row.apk_size_bytes,
    'apk_sha256', v_row.apk_sha256,
    'release_notes', v_row.release_notes,
    'is_required', v_row.is_required
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_active_app_release(text, text) TO authenticated;
