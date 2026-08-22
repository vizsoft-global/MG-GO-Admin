-- Shift-end auto-checkout, leftover On Duty without today's clock-in,
-- Time-in-today from closed sessions, and early-out cap on the daily view.
--
-- Admin On Duty was `drivers.is_on_duty` on today's date spine, so a leftover
-- flag after login (no clock-in) read On Duty while the app toggle stayed Out.
-- Nothing checked the rider out at session1_end, so the same flag survived
-- overnight. Time in today used `driver_attendance.last_online_at` (heartbeat)
-- so a re-clock-in started from 0.

ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_check_out_reason_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_check_out_reason_check
  CHECK (
    check_out_reason IS NULL
    OR check_out_reason = ANY (
      ARRAY[
        'manual'::text,
        'auto_offline'::text,
        'auto_out_of_zone'::text,
        'auto_shift_end'::text,
        'admin'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public._attendance_apply_checkout(
  p_driver_id uuid,
  p_reason text,
  p_now timestamp with time zone DEFAULT now(),
  p_distance_meters numeric DEFAULT NULL::numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log_id uuid;
  v_open_session_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'manual', 'auto_offline', 'auto_out_of_zone', 'auto_shift_end', 'admin'
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_run_attendance_auto_checkout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_minutes integer;
  v_cutoff timestamptz;
  v_count integer := 0;
  r record;
  v_reason text;
  v_offline_at timestamptz;
  v_shift public.driver_daily_shifts;
  v_shift_end timestamptz;
BEGIN
  SELECT COALESCE(attendance_auto_checkout_minutes, 45)
  INTO v_minutes
  FROM public.app_settings
  WHERE id = 1;

  v_minutes := GREATEST(COALESCE(v_minutes, 45), 1);
  v_cutoff := v_now - make_interval(mins => v_minutes);

  FOR r IN
    SELECT
      d.id AS driver_id,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      dl.latitude,
      dl.longitude,
      al.id AS open_log_id,
      al.log_date AS open_log_date,
      (
        SELECT ds.went_offline_at
        FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id
          AND ds.is_online = false
          AND ds.went_offline_at IS NOT NULL
        ORDER BY ds.went_offline_at DESC
        LIMIT 1
      ) AS went_offline_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions s
        WHERE s.driver_id = d.id AND s.is_online = true
      ) AS is_online_now
    FROM public.drivers d
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN LATERAL (
      SELECT al2.id, al2.log_date
      FROM public.attendance_logs al2
      WHERE al2.driver_id = d.id
        AND al2.check_in_at IS NOT NULL
        AND al2.check_out_at IS NULL
      ORDER BY al2.check_in_at DESC
      LIMIT 1
    ) al ON true
    WHERE d.is_on_duty = true
      AND d.archived_at IS NULL
  LOOP
    v_reason := NULL;
    v_offline_at := CASE WHEN r.is_online_now THEN NULL ELSE r.went_offline_at END;
    v_shift := NULL;
    v_shift_end := NULL;

    IF r.open_log_id IS NULL THEN
      v_reason := 'auto_shift_end';
    ELSE
      SELECT *
      INTO v_shift
      FROM public.driver_daily_shifts ds
      WHERE ds.driver_id = r.driver_id
        AND ds.shift_date = r.open_log_date
      LIMIT 1;

      IF FOUND THEN
        v_shift_end := public._driver_shift_end_at(v_shift);
      END IF;

      IF v_shift_end IS NOT NULL AND v_now >= v_shift_end THEN
        v_reason := 'auto_shift_end';
      ELSIF r.open_log_date IS NOT NULL AND r.open_log_date < v_today THEN
        v_reason := 'auto_shift_end';
      ELSIF v_offline_at IS NOT NULL AND v_offline_at <= v_cutoff THEN
        v_reason := 'auto_offline';
      ELSIF r.out_of_zone_since IS NOT NULL AND r.out_of_zone_since <= v_cutoff THEN
        v_reason := 'auto_out_of_zone';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      PERFORM public._attendance_apply_checkout(
        r.driver_id,
        v_reason,
        v_now,
        r.distance_today_meters
      );

      PERFORM public.log_driver_operation(
        r.driver_id, 'duty', 'duty.auto_checkout', 'cron',
        'admin_run_attendance_auto_checkout', true, NULL, NULL, NULL,
        jsonb_build_object(
          'reason', v_reason,
          'threshold_minutes', v_minutes,
          'offline_since', v_offline_at,
          'out_of_zone_since', r.out_of_zone_since,
          'shift_end_at', v_shift_end,
          'open_log_date', r.open_log_date
        ),
        r.latitude, r.longitude
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public._driver_shift_adherence(
  p_driver_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.driver_daily_shifts%ROWTYPE;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_actual_in timestamptz;
  v_actual_out timestamptz;
  v_online_seconds integer := 0;
  v_session_seconds integer := 0;
  v_scheduled_seconds integer;
  v_minutes_late integer;
  v_minutes_early_out integer;
  v_grace integer := 10;
BEGIN
  SELECT COALESCE(s.attendance_late_grace_minutes, 10)
  INTO v_grace
  FROM public.app_settings s
  WHERE s.id = 1;

  SELECT *
  INTO v_shift
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = p_driver_id
    AND ds.shift_date = p_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_scheduled_start := public.shift_session_instant(
    v_shift.shift_date,
    v_shift.session1_start,
    0
  );

  IF v_shift.shift_type = 'split'
    AND v_shift.session2_end IS NOT NULL THEN
    v_scheduled_end := public.shift_session_instant(
      v_shift.shift_date,
      v_shift.session2_end,
      COALESCE(v_shift.session2_end_day_offset, 0)
    );
  ELSE
    v_scheduled_end := public.shift_session_instant(
      v_shift.shift_date,
      v_shift.session1_end,
      v_shift.session1_end_day_offset
    );
  END IF;

  SELECT al.check_in_at, al.check_out_at
  INTO v_actual_in, v_actual_out
  FROM public.attendance_logs al
  WHERE al.driver_id = p_driver_id
    AND al.log_date = p_date;

  SELECT da.online_seconds
  INTO v_online_seconds
  FROM public.driver_attendance da
  WHERE da.driver_id = p_driver_id
    AND da.attendance_date = p_date;

  SELECT COALESCE(SUM(
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (sess.went_offline_at - sess.went_online_at))::integer
    )
  ), 0)
  INTO v_session_seconds
  FROM public.driver_sessions sess
  WHERE sess.driver_id = p_driver_id
    AND sess.went_online_at IS NOT NULL
    AND sess.went_offline_at IS NOT NULL
    AND (sess.went_online_at AT TIME ZONE 'Asia/Kuwait')::date = p_date;

  v_online_seconds := GREATEST(
    COALESCE(v_online_seconds, 0),
    COALESCE(v_session_seconds, 0)
  );

  IF v_actual_in IS NULL THEN
    SELECT COALESCE(al.check_in_at, da.first_online_at)
    INTO v_actual_in
    FROM public.drivers d
    LEFT JOIN public.attendance_logs al
      ON al.driver_id = d.id AND al.log_date = p_date
    LEFT JOIN public.driver_attendance da
      ON da.driver_id = d.id AND da.attendance_date = p_date
    WHERE d.id = p_driver_id;
  END IF;

  v_scheduled_seconds := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_scheduled_end - v_scheduled_start))::integer
  );

  IF v_actual_in IS NOT NULL AND v_scheduled_start IS NOT NULL THEN
    v_minutes_late := GREATEST(
      0,
      (EXTRACT(EPOCH FROM (v_actual_in - v_scheduled_start)) / 60)::integer - v_grace
    );
  ELSE
    v_minutes_late := 0;
  END IF;

  IF v_actual_out IS NOT NULL AND v_scheduled_end IS NOT NULL THEN
    v_minutes_early_out := LEAST(
      GREATEST(
        0,
        (
          EXTRACT(EPOCH FROM (
            v_scheduled_end - GREATEST(v_actual_out, v_scheduled_start)
          )) / 60
        )::integer
      ),
      (v_scheduled_seconds / 60)::integer
    );
  ELSE
    v_minutes_early_out := 0;
  END IF;

  RETURN jsonb_build_object(
    'scheduled_start_at', v_scheduled_start,
    'scheduled_end_at', v_scheduled_end,
    'actual_in_at', v_actual_in,
    'actual_out_at', v_actual_out,
    'minutes_late', v_minutes_late,
    'minutes_early_out', v_minutes_early_out,
    'online_seconds', COALESCE(v_online_seconds, 0),
    'scheduled_seconds', v_scheduled_seconds
  );
END;
$$;

CREATE OR REPLACE VIEW public.v_attendance_daily AS
 WITH settings AS (
         SELECT COALESCE(app_settings.attendance_late_grace_minutes, 10) AS late_grace,
            COALESCE(app_settings.attendance_early_out_grace_minutes, 5) AS early_grace,
            COALESCE(app_settings.attendance_gps_stale_minutes, 10) AS gps_stale,
            COALESCE(app_settings.attendance_gps_min_accuracy_meters, 100) AS gps_accuracy
           FROM app_settings
          WHERE app_settings.id = 1
        ), driver_days AS (
         SELECT al_1.driver_id,
            al_1.log_date AS attendance_date
           FROM attendance_logs al_1
        UNION
         SELECT ds.driver_id,
            ds.shift_date
           FROM driver_daily_shifts ds
        UNION
         SELECT da_1.driver_id,
            da_1.attendance_date
           FROM driver_attendance da_1
        ), shift_window AS (
         SELECT ds.driver_id,
            ds.shift_date AS attendance_date,
            ds.shift_type,
            shift_session_instant(ds.shift_date, ds.session1_start, 0) AS scheduled_start_at,
                CASE
                    WHEN ds.shift_type = 'split'::text AND ds.session2_end IS NOT NULL THEN shift_session_instant(ds.shift_date, ds.session2_end, COALESCE(ds.session2_end_day_offset::integer, 0))
                    ELSE shift_session_instant(ds.shift_date, ds.session1_end, ds.session1_end_day_offset::integer)
                END AS scheduled_end_at
           FROM driver_daily_shifts ds
        ), online_sessions AS (
         SELECT dd_1.driver_id,
            dd_1.attendance_date,
            COALESCE(sum(EXTRACT(epoch FROM COALESCE(sess.went_offline_at, now()) - sess.went_online_at))::integer, 0) AS session_online_seconds
           FROM driver_days dd_1
             JOIN driver_sessions sess ON sess.driver_id = dd_1.driver_id
          WHERE (sess.went_online_at AT TIME ZONE 'Asia/Kuwait'::text)::date = dd_1.attendance_date
          GROUP BY dd_1.driver_id, dd_1.attendance_date
        )
 SELECT dd.driver_id,
    dd.attendance_date AS log_date,
    d.driver_code,
    d.employee_id,
    p.full_name AS driver_name,
    p.phone AS driver_phone,
    d.partner_id,
    pt.name AS partner_name,
    d.zone_id,
    z.name AS zone_name,
    (d.is_on_duty
      AND al.check_in_at IS NOT NULL
      AND al.check_out_at IS NULL
      AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date) AS is_on_duty,
    sw.shift_type,
    sw.scheduled_start_at,
    sw.scheduled_end_at,
    al.id AS attendance_log_id,
    al.check_in_at,
    al.check_out_at,
    al.check_out_reason,
        CASE
            WHEN al.status = 'on_leave'::attendance_status THEN 'on_leave'::text
            WHEN d.is_on_duty
              AND al.check_in_at IS NOT NULL
              AND al.check_out_at IS NULL
              AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN 'present'::text
            WHEN al.check_in_at IS NOT NULL THEN 'present'::text
            WHEN sw.scheduled_start_at IS NOT NULL THEN 'absent'::text
            ELSE 'absent'::text
        END AS attendance_status,
    COALESCE(da.online_seconds, os.session_online_seconds, 0) AS online_seconds,
    GREATEST(0, EXTRACT(epoch FROM COALESCE(al.check_out_at,
        CASE
            WHEN d.is_on_duty
              AND al.check_in_at IS NOT NULL
              AND al.check_out_at IS NULL
              AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN now()
            ELSE NULL::timestamp with time zone
        END) - al.check_in_at)::integer) AS duty_seconds,
    GREATEST(0,
        CASE
            WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
               FROM settings))
            ELSE 0
        END) AS minutes_late,
    LEAST(
      GREATEST(0,
        CASE
            WHEN al.check_out_at IS NOT NULL AND sw.scheduled_end_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN
              (EXTRACT(epoch FROM (sw.scheduled_end_at - GREATEST(al.check_out_at, sw.scheduled_start_at))) / 60::numeric)::integer
              - (( SELECT settings.early_grace FROM settings))
            ELSE 0
        END),
      GREATEST(
        0,
        COALESCE(
          (EXTRACT(epoch FROM (sw.scheduled_end_at - sw.scheduled_start_at)) / 60::numeric)::integer,
          0
        )
      )
    ) AS minutes_early_out,
    dl.last_seen_at,
    dl.zone_status AS gps_zone_status,
    dl.accuracy_meters AS gps_accuracy_meters,
    dl.is_mocked AS gps_is_mocked,
        CASE
            WHEN sw.scheduled_start_at IS NULL THEN 'no_shift'::text
            WHEN al.check_in_at IS NULL THEN 'absent'::text
            WHEN GREATEST(0,
            CASE
                WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
                   FROM settings))
                ELSE 0
            END) > 0 THEN 'late'::text
            WHEN d.is_on_duty
              AND al.check_in_at IS NOT NULL
              AND al.check_out_at IS NULL
              AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date
              AND NOT (EXISTS ( SELECT 1
               FROM driver_sessions s
              WHERE s.driver_id = d.id AND s.is_online = true)) THEN 'offline_during_shift'::text
            WHEN d.is_on_duty
              AND al.check_in_at IS NOT NULL
              AND al.check_out_at IS NULL
              AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date
              AND dl.last_seen_at IS NOT NULL AND dl.last_seen_at < (now() - (((( SELECT settings.gps_stale
               FROM settings)) || ' minutes'::text)::interval)) THEN 'gps_stale'::text
            WHEN dl.zone_status = 'out_of_zone'::text THEN 'outside_zone'::text
            WHEN al.check_out_at IS NOT NULL THEN 'completed'::text
            WHEN d.is_on_duty
              AND al.check_in_at IS NOT NULL
              AND al.check_out_at IS NULL
              AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN 'on_duty'::text
            WHEN al.check_in_at IS NOT NULL THEN 'present'::text
            ELSE 'scheduled'::text
        END AS live_status,
        CASE
            WHEN al.check_in_at IS NULL OR sw.scheduled_start_at IS NULL THEN NULL::integer
            WHEN GREATEST(0, (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
               FROM settings))) > 0 THEN 70
            WHEN GREATEST(0, EXTRACT(epoch FROM COALESCE(al.check_out_at, now()) - al.check_in_at)::integer) > 0 THEN LEAST(100, round(COALESCE(da.online_seconds, os.session_online_seconds, 0)::numeric / NULLIF(EXTRACT(epoch FROM COALESCE(al.check_out_at, now()) - al.check_in_at), 0::numeric) * 100::numeric)::integer)
            ELSE 100
        END AS compliance_score
   FROM driver_days dd
     JOIN drivers d ON d.id = dd.driver_id
     JOIN profiles p ON p.id = d.id
     LEFT JOIN partners pt ON pt.id = d.partner_id
     LEFT JOIN zones z ON z.id = d.zone_id
     LEFT JOIN shift_window sw ON sw.driver_id = dd.driver_id AND sw.attendance_date = dd.attendance_date
     LEFT JOIN attendance_logs al ON al.driver_id = dd.driver_id AND al.log_date = dd.attendance_date
     LEFT JOIN driver_attendance da ON da.driver_id = dd.driver_id AND da.attendance_date = dd.attendance_date
     LEFT JOIN online_sessions os ON os.driver_id = dd.driver_id AND os.attendance_date = dd.attendance_date
     LEFT JOIN driver_locations dl ON dl.driver_id = d.id
  WHERE d.archived_at IS NULL;

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
        v_now - COALESCE(ds.went_online_at, da.last_online_at, da.first_online_at, v_now)
      ))::integer
    )
    INTO v_elapsed
    FROM public.driver_sessions ds
    LEFT JOIN public.driver_attendance da
      ON da.driver_id = v_driver_id
     AND da.attendance_date = v_log_date
    WHERE ds.id = v_open_session_id;

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
