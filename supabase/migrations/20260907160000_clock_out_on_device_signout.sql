-- Signing out of the active device must clock the driver out.
-- Otherwise is_on_duty + open driver_sessions stay true, admin Worktime
-- keeps adding live seconds, and the next login shows Clocked In.

CREATE OR REPLACE FUNCTION public.driver_release_device_session(
  p_device_id text
)
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

  IF v_active = v_norm THEN
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
END;
$function$;

COMMENT ON FUNCTION public.driver_release_device_session(text) IS
  'Clears this device session. When it is the active device, clocks the driver out (same as duty toggle off) so work-time stops.';
