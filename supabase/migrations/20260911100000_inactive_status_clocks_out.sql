-- Inactive / suspended / pending left is_on_duty and the open session true,
-- so Add Delivery failed (status gate) while Time in today kept counting.
-- End duty the same way block does: session + attendance, keep last GPS.

CREATE OR REPLACE FUNCTION public._end_driver_duty_keep_gps(
  p_driver_id uuid,
  p_reason text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_log_date date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_open_session_id uuid;
  v_elapsed integer := 0;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'manual', 'auto_offline', 'auto_out_of_zone', 'admin'
  ) THEN
    RAISE EXCEPTION 'invalid_check_out_reason';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = false,
      updated_at = v_now
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
    SELECT GREATEST(
      0,
      extract(epoch FROM (
        v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)
      ))::integer
    )
    INTO v_elapsed
    FROM public.driver_attendance da
    WHERE da.driver_id = p_driver_id
      AND da.attendance_date = v_log_date;

    UPDATE public.driver_attendance
    SET online_seconds = online_seconds + COALESCE(v_elapsed, 0),
        last_online_at = v_now,
        updated_at = v_now
    WHERE driver_id = p_driver_id
      AND attendance_date = v_log_date
      AND first_online_at IS NOT NULL;

    UPDATE public.driver_sessions
    SET is_online = false,
        went_offline_at = COALESCE(went_offline_at, v_now),
        updated_at = v_now
    WHERE id = v_open_session_id;
  END IF;

  UPDATE public.attendance_logs
  SET check_out_at = v_now,
      check_out_reason = p_reason,
      updated_at = v_now
  WHERE id = (
    SELECT al.id
    FROM public.attendance_logs al
    WHERE al.driver_id = p_driver_id
      AND al.check_in_at IS NOT NULL
      AND al.check_out_at IS NULL
    ORDER BY al.check_in_at DESC
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public._end_driver_duty_keep_gps(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.drivers_end_duty_on_inactive_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._end_driver_duty_keep_gps(NEW.id, 'admin');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_end_duty_on_inactive_status ON public.drivers;
CREATE TRIGGER drivers_end_duty_on_inactive_status
  AFTER UPDATE OF status ON public.drivers
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM 'active'::public.driver_status)
  EXECUTE FUNCTION public.drivers_end_duty_on_inactive_status();

COMMENT ON FUNCTION public._end_driver_duty_keep_gps(uuid, text) IS
  'Clocks out session + attendance without deleting last-known GPS. Used when account status leaves active, and by admin block.';

-- Clock-in / go-online must fail once the account is not active.
CREATE OR REPLACE FUNCTION public.driver_set_duty_state(p_is_on_duty boolean, p_is_online boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_distance_today numeric(12, 2) := 0;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_active_shift public.driver_daily_shifts;
  v_was_on_duty boolean;
  v_status public.driver_status;
  v_op_key text;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT d.is_on_duty, d.status INTO v_was_on_duty, v_status
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  IF p_is_on_duty OR p_is_online THEN
    IF v_status IS DISTINCT FROM 'active'::public.driver_status THEN
      PERFORM public.log_driver_operation_autonomous(
        v_driver_id, 'duty',
        CASE WHEN p_is_on_duty THEN 'duty.on' ELSE 'duty.online' END,
        'driver_set_duty_state', 'inactive',
        jsonb_build_object(
          'requested_on_duty', p_is_on_duty,
          'requested_online', p_is_online,
          'status', v_status
        )
      );
      RAISE EXCEPTION 'inactive';
    END IF;

    v_active_shift := public._driver_find_active_shift(v_driver_id, v_now);
    IF v_active_shift IS NULL OR v_active_shift.id IS NULL THEN
      PERFORM public.log_driver_operation_autonomous(
        v_driver_id, 'duty',
        CASE WHEN p_is_on_duty THEN 'duty.on' ELSE 'duty.online' END,
        'driver_set_duty_state', 'shift_required',
        jsonb_build_object('requested_on_duty', p_is_on_duty, 'requested_online', p_is_online)
      );
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
    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status, check_out_reason)
    VALUES (v_driver_id, v_log_date, v_now, 'present', NULL)
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          check_out_at = NULL,
          check_out_reason = NULL,
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
      SET is_online = true,
          went_offline_at = NULL,
          updated_at = v_now
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
    PERFORM public._attendance_apply_checkout(
      v_driver_id,
      'manual',
      v_now,
      v_distance_today
    );
  END IF;

  IF p_is_on_duty IS DISTINCT FROM v_was_on_duty THEN
    v_op_key := CASE WHEN p_is_on_duty THEN 'duty.on' ELSE 'duty.off' END;
  ELSE
    v_op_key := CASE WHEN p_is_online THEN 'duty.online' ELSE 'duty.offline' END;
  END IF;

  PERFORM public.log_driver_operation(
    v_driver_id, 'duty', v_op_key, 'rpc', 'driver_set_duty_state',
    true, NULL, 'driver', v_driver_id,
    jsonb_build_object(
      'is_on_duty', p_is_on_duty,
      'is_online', p_is_online,
      'duty_changed', p_is_on_duty IS DISTINCT FROM v_was_on_duty,
      'shift_id', v_active_shift.id
    )
  );

  RETURN public.driver_get_home_dashboard();
END;
$function$;
