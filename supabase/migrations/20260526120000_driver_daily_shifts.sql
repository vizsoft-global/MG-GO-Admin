-- Driver daily shift submissions (single / split, midnight-crossing aware).

CREATE TABLE IF NOT EXISTS public.driver_daily_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  shift_type text NOT NULL CHECK (shift_type IN ('single', 'split')),
  session1_start time NOT NULL,
  session1_end time NOT NULL,
  session1_end_day_offset smallint NOT NULL DEFAULT 0 CHECK (session1_end_day_offset IN (0, 1)),
  session2_start time,
  session2_end time,
  session2_start_day_offset smallint NOT NULL DEFAULT 0 CHECK (session2_start_day_offset IN (0, 1, 2)),
  session2_end_day_offset smallint NOT NULL DEFAULT 0 CHECK (session2_end_day_offset IN (0, 1, 2)),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, shift_date)
);

CREATE INDEX IF NOT EXISTS driver_daily_shifts_driver_date_idx
  ON public.driver_daily_shifts (driver_id, shift_date DESC);

ALTER TABLE public.driver_daily_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_daily_shifts_driver_select ON public.driver_daily_shifts;
CREATE POLICY driver_daily_shifts_driver_select ON public.driver_daily_shifts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_daily_shifts_staff_all ON public.driver_daily_shifts;
CREATE POLICY driver_daily_shifts_staff_all ON public.driver_daily_shifts
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- Build Kuwait-local instant from shift_date + time + day offset.
CREATE OR REPLACE FUNCTION public.shift_session_instant(
  p_shift_date date,
  p_time time,
  p_day_offset integer DEFAULT 0
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((p_shift_date + p_day_offset)::timestamp + p_time) AT TIME ZONE 'Asia/Kuwait';
$$;

CREATE OR REPLACE FUNCTION public._shift_end_day_offset(
  p_start time,
  p_end time,
  p_end_day_offset smallint DEFAULT NULL
)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_end_day_offset IS NOT NULL THEN
    RETURN p_end_day_offset;
  END IF;
  IF p_end <= p_start THEN
    RETURN 1;
  END IF;
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public._shift_row_to_json(
  p_row public.driver_daily_shifts,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_s1_start timestamptz;
  v_s1_end timestamptz;
  v_s2_start timestamptz;
  v_s2_end timestamptz;
  v_shift_end timestamptz;
  v_within boolean := false;
BEGIN
  v_s1_start := public.shift_session_instant(p_row.shift_date, p_row.session1_start, 0);
  v_s1_end := public.shift_session_instant(
    p_row.shift_date,
    p_row.session1_end,
    p_row.session1_end_day_offset
  );

  IF p_row.shift_type = 'split' THEN
    v_s2_start := public.shift_session_instant(
      p_row.shift_date,
      p_row.session2_start,
      p_row.session2_start_day_offset
    );
    v_s2_end := public.shift_session_instant(
      p_row.shift_date,
      p_row.session2_end,
      p_row.session2_end_day_offset
    );
    v_shift_end := GREATEST(v_s1_end, v_s2_end);
    v_within := (p_now >= v_s1_start AND p_now < v_s1_end)
      OR (p_now >= v_s2_start AND p_now < v_s2_end);
  ELSE
    v_shift_end := v_s1_end;
    v_within := p_now >= v_s1_start AND p_now < v_s1_end;
  END IF;

  RETURN jsonb_build_object(
    'id', p_row.id,
    'driver_id', p_row.driver_id,
    'shift_date', p_row.shift_date,
    'shift_type', p_row.shift_type,
    'session1_start', p_row.session1_start,
    'session1_end', p_row.session1_end,
    'session1_end_day_offset', p_row.session1_end_day_offset,
    'session2_start', p_row.session2_start,
    'session2_end', p_row.session2_end,
    'session2_start_day_offset', p_row.session2_start_day_offset,
    'session2_end_day_offset', p_row.session2_end_day_offset,
    'session1_start_at', v_s1_start,
    'session1_end_at', v_s1_end,
    'session2_start_at', v_s2_start,
    'session2_end_at', v_s2_end,
    'session1_crosses_midnight', p_row.session1_end_day_offset > 0,
    'session2_crosses_midnight', COALESCE(p_row.session2_end_day_offset, 0) > COALESCE(p_row.session2_start_day_offset, 0)
      OR (p_row.shift_type = 'split' AND p_row.session2_end <= p_row.session2_start),
    'shift_end_at', v_shift_end,
    'is_within_window', v_within,
    'is_locked', p_now < v_shift_end,
    'submitted_at', p_row.submitted_at
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
  v_yesterday date := v_today - 1;
  v_row public.driver_daily_shifts;
  v_shift_end timestamptz;
BEGIN
  SELECT *
  INTO v_row
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = p_driver_id
    AND ds.shift_date = v_today
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT *
  INTO v_row
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = p_driver_id
    AND ds.shift_date = v_yesterday
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.shift_type = 'split' THEN
    v_shift_end := GREATEST(
      public.shift_session_instant(v_row.shift_date, v_row.session1_end, v_row.session1_end_day_offset),
      public.shift_session_instant(v_row.shift_date, v_row.session2_end, v_row.session2_end_day_offset)
    );
  ELSE
    v_shift_end := public.shift_session_instant(
      v_row.shift_date,
      v_row.session1_end,
      v_row.session1_end_day_offset
    );
  END IF;

  IF p_now < v_shift_end THEN
    RETURN v_row;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_today_shift()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.driver_daily_shifts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_row := public._driver_find_active_shift(v_uid);

  IF v_row IS NULL OR v_row.id IS NULL THEN
    RETURN jsonb_build_object('shift', null);
  END IF;

  RETURN jsonb_build_object(
    'shift', public._shift_row_to_json(v_row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_submit_daily_shift(
  p_shift_type text,
  p_session1_start time,
  p_session1_end time,
  p_session2_start time DEFAULT NULL,
  p_session2_end time DEFAULT NULL,
  p_shift_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN jsonb_build_object(
    'shift', public._shift_row_to_json(v_row)
  );
END;
$$;

-- Require active shift before going on duty / online.
CREATE OR REPLACE FUNCTION public.driver_set_duty_state(
  p_is_on_duty boolean,
  p_is_online boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      RAISE EXCEPTION 'shift_required' USING MESSAGE = 'Submit today''s shift before going on duty';
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

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, v_now);
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

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
  ELSE
    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = v_now,
          updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = v_now,
        distance_meters = v_distance_today,
        updated_at = v_now
    WHERE driver_id = v_driver_id
      AND log_date = v_log_date
      AND check_out_at IS NULL;

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
    DELETE FROM public.driver_locations WHERE driver_id = v_driver_id;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_create_delivery(
  p_external_order_id text DEFAULT NULL,
  p_order_proof_url text DEFAULT NULL,
  p_delivered_lat numeric DEFAULT NULL,
  p_delivered_lng numeric DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text;
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_proximity integer;
  v_order_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_norm := public.normalize_external_order_id(p_external_order_id);

  IF v_norm IS NOT NULL AND v_norm <> '' THEN
    IF NOT public.driver_check_order_id_available(p_external_order_id) THEN
      RAISE EXCEPTION 'duplicate_order_id' USING MESSAGE = 'This order ID is already logged';
    END IF;
    v_order_id := trim(both '#' from trim(p_external_order_id));
  ELSE
    v_order_id := NULL;
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_driver.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'driver_not_active';
  END IF;

  IF NOT COALESCE(v_driver.is_on_duty, false) THEN
    RAISE EXCEPTION 'driver_off_duty' USING MESSAGE = 'You must be on duty to add a delivery';
  END IF;

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    RAISE EXCEPTION 'location_required' USING MESSAGE = 'GPS location is required';
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity > 0
     AND NOT public.driver_is_within_delivery_range(
       v_uid,
       p_delivered_lat::double precision,
       p_delivered_lng::double precision,
       v_proximity
     ) THEN
    RAISE EXCEPTION 'delivery_out_of_range'
      USING MESSAGE = 'You are outside the allowed delivery area';
  END IF;

  INSERT INTO public.deliveries (
    driver_id,
    partner_id,
    zone_id,
    external_order_id,
    order_proof_url,
    status,
    delivered_at,
    delivered_lat,
    delivered_lng
  ) VALUES (
    v_uid,
    v_driver.partner_id,
    v_driver.zone_id,
    v_order_id,
    NULLIF(trim(p_order_proof_url), ''),
    'pending',
    now(),
    p_delivered_lat,
    p_delivered_lng
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_today_shift() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_submit_daily_shift(text, time, time, time, time, date) TO authenticated;
