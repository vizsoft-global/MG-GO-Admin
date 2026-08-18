-- Suspended / Pending must end duty even if the AFTER UPDATE trigger is
-- skipped, and Sign out must clock out when this was the last live device
-- (a device-id mismatch used to leave is_on_duty true).

CREATE OR REPLACE FUNCTION public.set_driver_account_status(
  p_driver_id uuid,
  p_status public.driver_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_status = 'active'::public.driver_status
     AND NOT public.driver_has_active_restaurant(p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_active_restaurant');
  END IF;

  UPDATE public.drivers
  SET status = p_status, updated_at = now()
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_status IS DISTINCT FROM 'active'::public.driver_status THEN
    PERFORM public._end_driver_duty_keep_gps(p_driver_id, 'admin');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_release_device_session(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_active text;
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_distance_today numeric(12, 2) := 0;
  v_was_active boolean := false;
  v_should_clock_out boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF v_norm IS NULL THEN
    RETURN;
  END IF;

  SELECT d.active_device_id
  INTO v_active
  FROM public.drivers d
  WHERE d.id = v_uid;

  UPDATE public.driver_device_sessions s
  SET revoked_at = COALESCE(s.revoked_at, now()),
      revoked_reason = COALESCE(s.revoked_reason, 'manual_signout'),
      updated_at = now()
  WHERE s.driver_id = v_uid
    AND s.device_id = v_norm
    AND s.revoked_at IS NULL;

  v_was_active := v_active IS NOT DISTINCT FROM v_norm;
  v_should_clock_out := v_was_active OR NOT EXISTS (
    SELECT 1
    FROM public.driver_device_sessions s
    WHERE s.driver_id = v_uid
      AND s.revoked_at IS NULL
  );

  IF v_should_clock_out THEN
    UPDATE public.drivers d
    SET active_device_id = NULL,
        active_device_session_id = NULL,
        updated_at = now()
    WHERE d.id = v_uid;

    SELECT COALESCE(dl.distance_today_meters, 0)
    INTO v_distance_today
    FROM public.driver_locations dl
    WHERE dl.driver_id = v_uid;

    SELECT ds.id
    INTO v_open_session_id
    FROM public.driver_sessions ds
    WHERE ds.driver_id = v_uid
      AND ds.is_online = true
    ORDER BY ds.created_at DESC
    LIMIT 1;

    IF v_open_session_id IS NOT NULL THEN
      SELECT GREATEST(
        0,
        extract(epoch FROM (
          v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)
        ))::integer
      )
      INTO v_elapsed
      FROM public.driver_attendance da
      WHERE da.driver_id = v_uid
        AND da.attendance_date = v_log_date;

      UPDATE public.driver_attendance
      SET online_seconds = online_seconds + COALESCE(v_elapsed, 0),
          last_online_at = v_now,
          updated_at = v_now
      WHERE driver_id = v_uid
        AND attendance_date = v_log_date
        AND first_online_at IS NOT NULL;
    END IF;

    PERFORM public._attendance_apply_checkout(
      v_uid,
      'manual',
      v_now,
      v_distance_today
    );
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'device', 'device.signout', 'rpc', 'driver_release_device_session',
    true, NULL, 'device', NULL,
    jsonb_build_object(
      'device_id', v_norm,
      'clocked_out', v_should_clock_out,
      'was_active_device', v_was_active
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_driver_account_status(uuid, public.driver_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_release_device_session(text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_driver_account_status(uuid, public.driver_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_release_device_session(text) FROM PUBLIC;
