-- Phase 1: soft liveness fields (backward-compatible with old driver APKs).
-- Do NOT RAISE liveness_required here — that is Phase 2 after fleet adoption.

ALTER TABLE public.driver_login_verifications
  ADD COLUMN IF NOT EXISTS liveness_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS liveness_method text;

COMMENT ON COLUMN public.driver_login_verifications.liveness_passed IS
  'True when the driver app completed an on-device liveness challenge before capture.';
COMMENT ON COLUMN public.driver_login_verifications.liveness_method IS
  'Liveness method label from the app, e.g. mlkit_blink. Null for legacy rows.';

-- Drop 1-arg overload so PostgREST resolves the soft multi-arg signature
-- (defaults keep old clients that only send p_object_key working).
DROP FUNCTION IF EXISTS public.driver_record_login_verification(text);

CREATE OR REPLACE FUNCTION public.driver_record_login_verification(
  p_object_key text,
  p_liveness_passed boolean DEFAULT false,
  p_liveness_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_object_key, '')), '');
  v_row public.driver_login_verifications%ROWTYPE;
  v_expected_prefix text;
  v_passed boolean := COALESCE(p_liveness_passed, false);
  v_method text := NULLIF(btrim(COALESCE(p_liveness_method, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid) THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'object_key_required';
  END IF;

  v_expected_prefix := 'drivers/' || v_uid::text || '/login_verification/';
  IF position(v_expected_prefix in v_key) <> 1 THEN
    RAISE EXCEPTION 'invalid_object_key';
  END IF;

  -- Phase 1: accept DEFAULT false / omitted args from old APKs. No hard RAISE.

  INSERT INTO public.driver_login_verifications (
    driver_id,
    object_key,
    captured_at,
    liveness_passed,
    liveness_method
  )
  VALUES (v_uid, v_key, now(), v_passed, v_method)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'object_key', v_row.object_key,
    'captured_at', v_row.captured_at,
    'created_at', v_row.created_at,
    'liveness_passed', v_row.liveness_passed,
    'liveness_method', v_row.liveness_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_record_login_verification(text, boolean, text)
  TO authenticated;

COMMENT ON FUNCTION public.driver_record_login_verification(text, boolean, text) IS
  'Driver app: record login_verification upload. Phase 1 soft liveness (default false).';
