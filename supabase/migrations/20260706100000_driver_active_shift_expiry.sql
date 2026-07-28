-- Active shift expiry: today's row must also expire after shift_end_at.
-- Align shift adherence with active overnight shifts.

CREATE OR REPLACE FUNCTION public._driver_shift_end_at(
  p_row public.driver_daily_shifts
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_row.shift_type = 'split' AND p_row.session2_end IS NOT NULL THEN
    RETURN GREATEST(
      public.shift_session_instant(
        p_row.shift_date,
        p_row.session1_end,
        p_row.session1_end_day_offset
      ),
      public.shift_session_instant(
        p_row.shift_date,
        p_row.session2_end,
        COALESCE(p_row.session2_end_day_offset, 0)
      )
    );
  END IF;

  RETURN public.shift_session_instant(
    p_row.shift_date,
    p_row.session1_end,
    p_row.session1_end_day_offset
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._driver_find_active_shift(
  p_driver_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS public.driver_daily_shifts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (p_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_candidate_date date;
  v_row public.driver_daily_shifts;
  v_shift_end timestamptz;
BEGIN
  FOREACH v_candidate_date IN ARRAY ARRAY[v_today, v_today - 1] LOOP
    SELECT *
    INTO v_row
    FROM public.driver_daily_shifts ds
    WHERE ds.driver_id = p_driver_id
      AND ds.shift_date = v_candidate_date
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_shift_end := public._driver_shift_end_at(v_row);

    IF p_now < v_shift_end THEN
      RETURN v_row;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._driver_shift_row_for_adherence(
  p_driver_id uuid,
  p_date date,
  p_now timestamptz DEFAULT now()
)
RETURNS public.driver_daily_shifts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.driver_daily_shifts;
  v_shift_end timestamptz;
  v_end_date date;
BEGIN
  v_row := public._driver_find_active_shift(p_driver_id, p_now);

  IF v_row IS NOT NULL AND v_row.id IS NOT NULL THEN
    v_shift_end := public._driver_shift_end_at(v_row);
    v_end_date := (v_shift_end AT TIME ZONE 'Asia/Kuwait')::date;

    IF p_date >= v_row.shift_date AND p_date <= v_end_date THEN
      RETURN v_row;
    END IF;
  END IF;

  SELECT *
  INTO v_row
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = p_driver_id
    AND ds.shift_date = p_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_row;
END;
$$;

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
  v_shift public.driver_daily_shifts;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_actual_in timestamptz;
  v_actual_out timestamptz;
  v_online_seconds integer := 0;
  v_scheduled_seconds integer;
  v_minutes_late integer;
  v_minutes_early_out integer;
BEGIN
  v_shift := public._driver_shift_row_for_adherence(p_driver_id, p_date);

  IF v_shift IS NULL OR v_shift.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_scheduled_start := public.shift_session_instant(
    v_shift.shift_date,
    v_shift.session1_start,
    0
  );

  v_scheduled_end := public._driver_shift_end_at(v_shift);

  SELECT da.first_online_at, da.online_seconds
  INTO v_actual_in, v_online_seconds
  FROM public.driver_attendance da
  WHERE da.driver_id = p_driver_id
    AND da.attendance_date = p_date;

  SELECT al.check_out_at
  INTO v_actual_out
  FROM public.attendance_logs al
  WHERE al.driver_id = p_driver_id
    AND al.log_date = p_date;

  IF v_actual_in IS NULL THEN
    SELECT al.check_in_at
    INTO v_actual_in
    FROM public.attendance_logs al
    WHERE al.driver_id = p_driver_id
      AND al.log_date = p_date;
  END IF;

  v_scheduled_seconds := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_scheduled_end - v_scheduled_start))::integer
  );

  IF v_actual_in IS NOT NULL AND v_scheduled_start IS NOT NULL THEN
    v_minutes_late := GREATEST(
      0,
      (EXTRACT(EPOCH FROM (v_actual_in - v_scheduled_start)) / 60)::integer
    );
  ELSE
    v_minutes_late := 0;
  END IF;

  IF v_actual_out IS NOT NULL AND v_scheduled_end IS NOT NULL THEN
    v_minutes_early_out := GREATEST(
      0,
      (EXTRACT(EPOCH FROM (v_scheduled_end - v_actual_out)) / 60)::integer
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
