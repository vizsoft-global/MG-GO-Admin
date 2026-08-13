-- Emit driver_operation_events from the duty RPCs. Signatures unchanged.
--
-- These are the first users of the autonomous emitter. Both are Class B (they
-- RAISE), and both are low-volume and driver-initiated, which is exactly the
-- allowlist criterion: one dblink loopback per rejected clock-in is fine, one
-- per GPS heartbeat would not be.
--
-- Only the two failures an admin would act on are logged. Client-preventable
-- validation errors (invalid_shift_type, future_date, session ordering) are not
-- worth a loopback connection each.
--
-- driver_set_duty_state emits ONE row per call, not one per flag. A clock-in is
-- a single thing the driver did; splitting it into duty.on plus duty.online
-- would make every timeline read double.

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
  v_op_key text;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT d.is_on_duty INTO v_was_on_duty
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  IF p_is_on_duty OR p_is_online THEN
    v_active_shift := public._driver_find_active_shift(v_driver_id, v_now);
    IF v_active_shift IS NULL OR v_active_shift.id IS NULL THEN
      -- Autonomous: the RAISE below rolls this transaction back, so an in-tx
      -- audit row would vanish with it.
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

  -- Key on the duty transition when duty actually moved (clock in / clock out),
  -- otherwise on the online toggle.
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

CREATE OR REPLACE FUNCTION public.driver_submit_daily_shift(
  p_shift_type text,
  p_session1_start time without time zone,
  p_session1_end time without time zone,
  p_session2_start time without time zone DEFAULT NULL::time without time zone,
  p_session2_end time without time zone DEFAULT NULL::time without time zone,
  p_shift_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_shift_date date := COALESCE(p_shift_date, v_today);
  v_existing public.driver_daily_shifts;
  v_s1_end_offset smallint;
  v_s2_start_offset smallint := 0;
  v_s2_end_offset smallint := 0;
  v_s1_start timestamptz;
  v_s1_end timestamptz;
  v_s2_start timestamptz;
  v_s2_end timestamptz;
  v_shift_end timestamptz;
  v_row public.driver_daily_shifts;
  v_offset_try integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_shift_type NOT IN ('single', 'split') THEN
    RAISE EXCEPTION 'invalid_shift_type';
  END IF;

  IF v_shift_date > v_today THEN
    RAISE EXCEPTION 'future_date';
  END IF;

  IF p_session1_start IS NULL OR p_session1_end IS NULL THEN
    RAISE EXCEPTION 'session1_required';
  END IF;

  v_s1_end_offset := public._shift_end_day_offset(p_session1_start, p_session1_end, NULL);
  v_s1_start := public.shift_session_instant(v_shift_date, p_session1_start, 0);
  v_s1_end := public.shift_session_instant(v_shift_date, p_session1_end, v_s1_end_offset);

  IF v_s1_end <= v_s1_start THEN
    RAISE EXCEPTION 'invalid_session1_duration';
  END IF;

  IF extract(epoch FROM (v_s1_end - v_s1_start)) > 86400 THEN
    RAISE EXCEPTION 'session_too_long';
  END IF;

  IF p_shift_type = 'split' THEN
    IF p_session2_start IS NULL OR p_session2_end IS NULL THEN
      RAISE EXCEPTION 'session2_required';
    END IF;

    IF v_s1_end_offset = 0 AND p_session2_start < p_session1_end THEN
      RAISE EXCEPTION 'sessions_overlap';
    END IF;

    -- Session 2 must start at or after session 1 ends (try day offsets 0..2).
    FOR v_offset_try IN 0..2 LOOP
      v_s2_start_offset := v_offset_try::smallint;
      v_s2_start := public.shift_session_instant(
        v_shift_date,
        p_session2_start,
        v_s2_start_offset
      );
      EXIT WHEN v_s2_start >= v_s1_end;
    END LOOP;

    IF v_s2_start < v_s1_end THEN
      RAISE EXCEPTION 'sessions_overlap';
    END IF;

    IF p_session2_end <= p_session2_start THEN
      v_s2_end_offset := v_s2_start_offset + 1;
    ELSE
      v_s2_end_offset := v_s2_start_offset;
    END IF;

    v_s2_end := public.shift_session_instant(
      v_shift_date,
      p_session2_end,
      v_s2_end_offset
    );

    IF v_s2_end <= v_s2_start THEN
      RAISE EXCEPTION 'invalid_session2_duration';
    END IF;

    IF extract(epoch FROM (v_s2_end - v_s2_start)) > 86400 THEN
      RAISE EXCEPTION 'session_too_long';
    END IF;

    v_shift_end := GREATEST(v_s1_end, v_s2_end);
  ELSE
    IF p_session2_start IS NOT NULL OR p_session2_end IS NOT NULL THEN
      RAISE EXCEPTION 'session2_not_allowed';
    END IF;
    v_shift_end := v_s1_end;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = v_uid
    AND ds.shift_date = v_shift_date;

  IF FOUND THEN
    IF v_existing.shift_type = 'split' THEN
      v_shift_end := GREATEST(
        public.shift_session_instant(v_existing.shift_date, v_existing.session1_end, v_existing.session1_end_day_offset),
        public.shift_session_instant(v_existing.shift_date, v_existing.session2_end, v_existing.session2_end_day_offset)
      );
    ELSE
      v_shift_end := public.shift_session_instant(
        v_existing.shift_date,
        v_existing.session1_end,
        v_existing.session1_end_day_offset
      );
    END IF;

    IF now() < v_shift_end THEN
      -- Autonomous: a driver trying to rewrite a shift that is still running is
      -- worth seeing, and the RAISE below would discard an in-tx row.
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'shift_locked',
        jsonb_build_object(
          'shift_date', v_shift_date,
          'requested_shift_type', p_shift_type,
          'locked_until', v_shift_end
        )
      );
      RAISE EXCEPTION 'shift_locked';
    END IF;
  END IF;

  INSERT INTO public.driver_daily_shifts (
    driver_id,
    shift_date,
    shift_type,
    session1_start,
    session1_end,
    session1_end_day_offset,
    session2_start,
    session2_end,
    session2_start_day_offset,
    session2_end_day_offset,
    submitted_at,
    updated_at
  )
  VALUES (
    v_uid,
    v_shift_date,
    p_shift_type,
    p_session1_start,
    p_session1_end,
    v_s1_end_offset,
    CASE WHEN p_shift_type = 'split' THEN p_session2_start ELSE NULL END,
    CASE WHEN p_shift_type = 'split' THEN p_session2_end ELSE NULL END,
    CASE WHEN p_shift_type = 'split' THEN v_s2_start_offset ELSE 0 END,
    CASE WHEN p_shift_type = 'split' THEN v_s2_end_offset ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (driver_id, shift_date) DO UPDATE SET
    shift_type = EXCLUDED.shift_type,
    session1_start = EXCLUDED.session1_start,
    session1_end = EXCLUDED.session1_end,
    session1_end_day_offset = EXCLUDED.session1_end_day_offset,
    session2_start = EXCLUDED.session2_start,
    session2_end = EXCLUDED.session2_end,
    session2_start_day_offset = EXCLUDED.session2_start_day_offset,
    session2_end_day_offset = EXCLUDED.session2_end_day_offset,
    submitted_at = EXCLUDED.submitted_at,
    updated_at = now()
  RETURNING * INTO v_row;

  PERFORM public.log_driver_operation(
    v_uid, 'duty', 'shift.submit', 'rpc', 'driver_submit_daily_shift',
    true, NULL, 'daily_shift', v_row.id,
    jsonb_build_object(
      'shift_date', v_row.shift_date,
      'shift_type', v_row.shift_type,
      'resubmitted', v_existing.id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'shift', public._shift_row_to_json(v_row)
  );
END;
$function$;
