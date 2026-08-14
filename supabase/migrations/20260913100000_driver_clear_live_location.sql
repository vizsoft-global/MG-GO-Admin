-- When OS location is off the duty tracker cannot report, so the last pin
-- stays "live" and Admin shows Idle. Clock-out must keep that pin (Offline).
-- Location-off deletes only the caller's row, and only while still on duty.

CREATE OR REPLACE FUNCTION public.driver_clear_live_location()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_on_duty boolean;
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT d.is_on_duty
  INTO v_on_duty
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  -- Late FGS ticks after clock-out must not erase the Offline last-known pin.
  IF NOT v_on_duty THEN
    RETURN jsonb_build_object('cleared', false, 'reason', 'off_duty');
  END IF;

  DELETE FROM public.driver_locations
  WHERE driver_id = v_uid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('cleared', v_deleted > 0);
END;
$$;

COMMENT ON FUNCTION public.driver_clear_live_location() IS
  'Removes the caller live pin when OS location is off. Clock-out must not call this — Offline keeps last-known GPS.';

REVOKE ALL ON FUNCTION public.driver_clear_live_location() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_clear_live_location() FROM anon;
REVOKE ALL ON FUNCTION public.driver_clear_live_location() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.driver_clear_live_location() TO authenticated;
