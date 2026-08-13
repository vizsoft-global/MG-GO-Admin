-- Login identity selfie audit (separate from attendance).
-- Driver app uploads via entityType login_verification, then calls this RPC.

CREATE TABLE IF NOT EXISTS public.driver_login_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_login_verifications_driver_created_idx
  ON public.driver_login_verifications (driver_id, created_at DESC);

COMMENT ON TABLE public.driver_login_verifications IS
  'Daily login identity selfie audit trail for the driver app. Not attendance.';

ALTER TABLE public.driver_login_verifications ENABLE ROW LEVEL SECURITY;

-- No direct client INSERT/UPDATE/DELETE. Drivers write via SECURITY DEFINER RPC.
-- Admin read policies can be added with the future Admin UI.

CREATE OR REPLACE FUNCTION public.driver_record_login_verification(
  p_object_key text
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

  INSERT INTO public.driver_login_verifications (driver_id, object_key, captured_at)
  VALUES (v_uid, v_key, now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'object_key', v_row.object_key,
    'captured_at', v_row.captured_at,
    'created_at', v_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_record_login_verification(text) TO authenticated;

COMMENT ON FUNCTION public.driver_record_login_verification(text) IS
  'Driver app: record a completed login_verification R2 upload for audit.';
