-- Early-out cannot exceed the scheduled window length.
-- The 11:30–16:30 / 09:35-out case is 300 remaining minutes, never 415
-- (end − out, which counts the pre-shift gap). GREATEST(out, start) already
-- clamps that on a consistent timestamptz timeline; LEAST vs scheduled_seconds
-- is the invariant so a mixed-offset client or stale payload cannot show more
-- early-out than the shift itself.

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
