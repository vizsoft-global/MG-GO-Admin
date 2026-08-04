-- Single release channel: 'production' only.
-- Sideload OTA was removed (Play Store only), so beta/internal channels no longer
-- exist. Version adoption tracking keeps working, collapsed onto one channel.

-- Collapse existing driver-reported channels.
UPDATE public.drivers
SET current_app_channel = 'production'
WHERE current_app_channel IS DISTINCT FROM 'production'
  AND current_app_channel IS NOT NULL;

UPDATE public.driver_app_version_history
SET channel = 'production'
WHERE channel IS DISTINCT FROM 'production'
  AND channel IS NOT NULL;

-- No active sideload release, ever. Kept for API/RPC compatibility.
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  -- In-app APK distribution removed; updates ship via Google Play only.
  RETURN NULL;
END;
$$;

-- Version adoption ping: channel argument accepted for backward compatibility
-- with installed builds, but always stored as 'production'.
CREATE OR REPLACE FUNCTION public.driver_record_app_version(
  p_platform text DEFAULT 'android',
  p_channel text DEFAULT 'production',
  p_version_name text DEFAULT NULL,
  p_version_code integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_prev_code integer;
  v_channel constant text := 'production';
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_version_code IS NULL OR p_version_code <= 0 THEN
    RETURN;
  END IF;

  SELECT d.current_app_version_code
  INTO v_prev_code
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  UPDATE public.drivers
  SET
    current_app_platform = p_platform,
    current_app_channel = v_channel,
    current_app_version_name = NULLIF(btrim(p_version_name), ''),
    current_app_version_code = p_version_code,
    app_version_seen_at = now(),
    updated_at = now()
  WHERE id = v_driver_id;

  IF v_prev_code IS DISTINCT FROM p_version_code THEN
    INSERT INTO public.driver_app_version_history (
      driver_id,
      platform,
      channel,
      version_name,
      version_code
    )
    VALUES (
      v_driver_id,
      p_platform,
      v_channel,
      NULLIF(btrim(p_version_name), ''),
      p_version_code
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.driver_record_app_version(text, text, text, integer) IS
  'Records the installed driver app version. Single channel: always production.';

COMMENT ON TABLE public.app_releases IS
  'Deprecated: sideload APK releases removed (Play Store only). Retained for history.';
