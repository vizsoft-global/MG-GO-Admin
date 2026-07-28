-- On duty means present: do not check out attendance when the driver is still on duty
-- but only toggled offline. Always upsert a present attendance log when going on duty.

CREATE OR REPLACE FUNCTION public.driver_set_duty_state(p_is_on_duty boolean, p_is_online boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_distance_today numeric(12, 2) := 0;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_active_shift public.driver_daily_shifts;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_is_on_duty OR p_is_online THEN
    v_active_shift := public._driver_find_active_shift(v_driver_id, v_now);
    IF v_active_shift IS NULL OR v_active_shift.id IS NULL THEN
      RAISE EXCEPTION 'shift_required';
    END IF;
  END IF;

  UPDATE public.drivers
  SET is_on_duty = p_is_on_duty,
      updated_at = v_now
  WHERE id = v_driver_id;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  SELECT COALESCE(dl.distance_today_meters, 0)
  INTO v_distance_today
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_driver_id;

  IF p_is_on_duty THEN
    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status)
    VALUES (v_driver_id, v_log_date, v_now, 'present')
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          check_out_at = NULL,
          status = CASE
            WHEN attendance_logs.status = 'on_leave' THEN attendance_logs.status
            ELSE 'present'
          END,
          updated_at = v_now;
  END IF;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, v_now);
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

    INSERT INTO public.driver_attendance (
      driver_id,
      attendance_date,
      first_online_at,
      last_online_at,
      status
    )
    VALUES (v_driver_id, v_log_date, v_now, v_now, 'online_unvalidated')
    ON CONFLICT (driver_id, attendance_date) DO UPDATE
      SET first_online_at = COALESCE(driver_attendance.first_online_at, EXCLUDED.first_online_at),
          last_online_at = v_now,
          status = CASE
            WHEN driver_attendance.status = 'present' THEN 'present'
            ELSE 'online_unvalidated'
          END,
          updated_at = v_now;
  ELSIF v_open_session_id IS NOT NULL THEN
    UPDATE public.driver_sessions
    SET is_online = false,
        went_offline_at = v_now,
        updated_at = v_now
    WHERE id = v_open_session_id;

    SELECT GREATEST(
      0,
      extract(epoch FROM (
        v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)
      ))::integer
    )
    INTO v_elapsed
    FROM public.driver_attendance da
    WHERE da.driver_id = v_driver_id
      AND da.attendance_date = v_log_date;

    UPDATE public.driver_attendance
    SET online_seconds = online_seconds + COALESCE(v_elapsed, 0),
        last_online_at = v_now,
        status = CASE
          WHEN status = 'present' THEN 'present'
          ELSE 'online_unvalidated'
        END,
        updated_at = v_now
    WHERE driver_id = v_driver_id
      AND attendance_date = v_log_date
      AND first_online_at IS NOT NULL;
  END IF;

  IF NOT p_is_on_duty THEN
    UPDATE public.attendance_logs
    SET check_out_at = v_now,
        distance_meters = v_distance_today,
        updated_at = v_now
    WHERE driver_id = v_driver_id
      AND log_date = v_log_date
      AND check_out_at IS NULL;

    DELETE FROM public.driver_locations WHERE driver_id = v_driver_id;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$function$;

COMMENT ON FUNCTION public.driver_set_duty_state(boolean, boolean) IS
  'Driver app: toggle on-duty and online. On duty always records present attendance; checkout only when going off duty.';

-- Repair drivers currently on duty but marked absent for today (Kuwait date).
INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status)
SELECT
  d.id,
  (now() AT TIME ZONE 'Asia/Kuwait')::date,
  now(),
  'present'::public.attendance_status
FROM public.drivers d
WHERE d.is_on_duty = true
  AND d.status = 'active'::public.driver_status
  AND d.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.attendance_logs al
    WHERE al.driver_id = d.id
      AND al.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
  );

UPDATE public.attendance_logs al
SET
  check_out_at = NULL,
  status = CASE
    WHEN al.status = 'on_leave'::public.attendance_status THEN al.status
    ELSE 'present'::public.attendance_status
  END,
  check_in_at = COALESCE(al.check_in_at, now()),
  updated_at = now()
FROM public.drivers d
WHERE d.id = al.driver_id
  AND d.is_on_duty = true
  AND d.status = 'active'::public.driver_status
  AND d.archived_at IS NULL
  AND al.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
  AND al.check_out_at IS NOT NULL
  AND al.status <> 'on_leave'::public.attendance_status;
