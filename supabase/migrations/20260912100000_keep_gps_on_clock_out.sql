-- Clock-out must keep last-known GPS so Live Tracking can show Offline.
-- _attendance_apply_checkout still deleted the driver_locations row, which
-- removed the rider from the list and map instead of flipping the chip.

CREATE OR REPLACE FUNCTION public._attendance_apply_checkout(
  p_driver_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now(),
  p_distance_meters numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log_id uuid;
  v_open_session_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'manual', 'auto_offline', 'auto_out_of_zone', 'admin'
  ) THEN
    RAISE EXCEPTION 'invalid_check_out_reason';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = false,
      updated_at = p_now
  WHERE id = p_driver_id
    AND is_on_duty = true;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = p_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  IF v_open_session_id IS NOT NULL THEN
    UPDATE public.driver_sessions
    SET is_online = false,
        went_offline_at = COALESCE(went_offline_at, p_now),
        updated_at = p_now
    WHERE id = v_open_session_id;
  END IF;

  UPDATE public.attendance_logs
  SET check_out_at = p_now,
      check_out_reason = p_reason,
      distance_meters = COALESCE(p_distance_meters, distance_meters),
      updated_at = p_now
  WHERE id = (
    SELECT al.id
    FROM public.attendance_logs al
    WHERE al.driver_id = p_driver_id
      AND al.check_in_at IS NOT NULL
      AND al.check_out_at IS NULL
    ORDER BY al.check_in_at DESC
    LIMIT 1
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public._attendance_apply_checkout(uuid, text, timestamptz, numeric) IS
  'Clocks out session + attendance without deleting last-known GPS.';
