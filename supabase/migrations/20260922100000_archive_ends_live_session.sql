-- Archiving a driver left the live app session usable: archive_driver_intake
-- only stamped archived_at, so pickup/complete still passed
-- _driver_assert_active_on_duty (status=active, still on duty). End duty,
-- revoke the device session, and refuse archived drivers on the duty/pickup
-- path so an open app is restricted without a re-login.

ALTER TABLE public.driver_device_sessions
  DROP CONSTRAINT IF EXISTS driver_device_sessions_revoked_reason_check;

ALTER TABLE public.driver_device_sessions
  ADD CONSTRAINT driver_device_sessions_revoked_reason_check
  CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN (
      'override',
      'manual_signout',
      'admin_forced',
      'flushed',
      'archived'
    )
  );

CREATE OR REPLACE FUNCTION public._end_driver_app_session(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._end_driver_duty_keep_gps(p_driver_id, 'admin');

  UPDATE public.driver_device_sessions s
  SET revoked_at = COALESCE(s.revoked_at, now()),
      revoked_reason = COALESCE(s.revoked_reason, 'archived'),
      updated_at = now()
  WHERE s.driver_id = p_driver_id
    AND s.revoked_at IS NULL;

  UPDATE public.drivers
  SET active_device_id = NULL,
      active_device_session_id = NULL,
      updated_at = now()
  WHERE id = p_driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public._end_driver_app_session(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.drivers_end_session_on_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._end_driver_app_session(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_end_session_on_archive ON public.drivers;
CREATE TRIGGER drivers_end_session_on_archive
  AFTER UPDATE OF archived_at ON public.drivers
  FOR EACH ROW
  WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  EXECUTE FUNCTION public.drivers_end_session_on_archive();

CREATE OR REPLACE FUNCTION public.archive_driver_intake(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked uuid;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT linked_profile_id INTO v_linked
  FROM public.driver_intakes
  WHERE id = p_intake_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  UPDATE public.driver_intakes
  SET
    archived_at = now(),
    status = 'cancelled'::public.driver_intake_status,
    updated_at = now()
  WHERE id = p_intake_id;

  IF v_linked IS NOT NULL THEN
    UPDATE public.drivers
    SET archived_at = now(), updated_at = now()
    WHERE id = v_linked
      AND archived_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public._driver_assert_active_on_duty(p_uid uuid)
RETURNS public.drivers
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;
  IF v_driver.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'driver_archived';
  END IF;
  IF v_driver.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'driver_not_active';
  END IF;
  IF NOT v_driver.is_on_duty THEN
    RAISE EXCEPTION 'driver_off_duty';
  END IF;
  RETURN v_driver;
END;
$function$;

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
  v_archived_at timestamptz;
  v_op_key text;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT d.is_on_duty, d.status, d.archived_at
  INTO v_was_on_duty, v_status, v_archived_at
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  IF p_is_on_duty OR p_is_online THEN
    IF v_archived_at IS NOT NULL THEN
      PERFORM public.log_driver_operation_autonomous(
        v_driver_id, 'duty',
        CASE WHEN p_is_on_duty THEN 'duty.on' ELSE 'duty.online' END,
        'driver_set_duty_state', 'driver_archived',
        jsonb_build_object(
          'requested_on_duty', p_is_on_duty,
          'requested_online', p_is_online
        )
      );
      RAISE EXCEPTION 'driver_archived';
    END IF;

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

COMMENT ON FUNCTION public._end_driver_app_session(uuid) IS
  'Clocks out and revokes every live device session. Used when a driver is archived.';

COMMENT ON FUNCTION public.archive_driver_intake(uuid) IS
  'Staff-only: stamp archived_at. The drivers_end_session_on_archive trigger clocks out and revokes the live app session.';
