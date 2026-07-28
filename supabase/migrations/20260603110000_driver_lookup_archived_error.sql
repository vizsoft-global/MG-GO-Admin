-- Return explicit error when login targets an archived driver (same code + passcode).
CREATE OR REPLACE FUNCTION public.driver_app_lookup_by_passcode(
  p_driver_code text,
  p_passcode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_code text;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  v_code := btrim(p_driver_code);

  SELECT id, status, driver_code, archived_at
  INTO v_driver
  FROM public.drivers
  WHERE driver_code = v_code
    AND app_passcode = p_passcode
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_driver.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_archived');
  END IF;

  IF v_driver.status <> 'active'::public.driver_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_active');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_driver.id,
    'driver_code', v_driver.driver_code
  );
END;
$$;
