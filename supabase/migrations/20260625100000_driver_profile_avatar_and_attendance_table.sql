-- Driver attendance table for app month grid + avatar support.
-- Keeps legacy attendance_logs/admin workflows intact.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS avatar_object_key text,
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.driver_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  online_seconds integer NOT NULL DEFAULT 0,
  first_online_at timestamptz,
  last_online_at timestamptz,
  is_validated boolean NOT NULL DEFAULT false,
  validated_at timestamptz,
  valid_ping_count integer NOT NULL DEFAULT 0,
  total_ping_count integer NOT NULL DEFAULT 0,
  validation_source text CHECK (validation_source IN ('restaurant', 'zone')),
  validation_ref_id uuid,
  status text NOT NULL DEFAULT 'absent'
    CHECK (status IN ('absent', 'online_unvalidated', 'present')),
  is_manual boolean NOT NULL DEFAULT false,
  manual_reason text,
  corrected_by uuid REFERENCES auth.users(id),
  corrected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS driver_attendance_driver_date_idx
  ON public.driver_attendance (driver_id, attendance_date DESC);

ALTER TABLE public.driver_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_attendance_driver_select ON public.driver_attendance;
CREATE POLICY driver_attendance_driver_select ON public.driver_attendance
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_attendance_staff_all ON public.driver_attendance;
CREATE POLICY driver_attendance_staff_all ON public.driver_attendance
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'driver_attendance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_attendance;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.driver_update_avatar(
  p_object_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_object_key, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid) THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  UPDATE public.drivers
  SET avatar_object_key = v_key,
      avatar_updated_at = now(),
      updated_at = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'avatar_object_key', v_key,
    'avatar_updated_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_report_location(
  p_latitude numeric,
  p_longitude numeric,
  p_speed_mps numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_battery_pct smallint DEFAULT NULL,
  p_tracking_status text DEFAULT 'idle',
  p_delivery_id uuid DEFAULT NULL,
  p_force_history boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_prev public.driver_locations%ROWTYPE;
  v_last_event public.driver_location_events%ROWTYPE;
  v_in_range boolean;
  v_zone_status text;
  v_proximity integer;
  v_history_written boolean := false;
  v_now timestamptz := now();
  v_now_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_dist_m double precision;
  v_secs_since_event double precision;
  v_status text := lower(trim(coalesce(p_tracking_status, 'idle')));
  v_segment_m double precision := 0;
  v_distance_today numeric(12, 2) := 0;
  v_is_moving boolean := false;
  v_has_restaurants boolean := false;
  v_inside_restaurant boolean := false;
  v_inside_zone boolean := false;
  v_zone_row public.zones%ROWTYPE;
  v_validation_source text;
  v_validation_ref uuid;
  v_attendance_row public.driver_attendance%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_status NOT IN ('idle', 'moving', 'delivery_submit') THEN
    RAISE EXCEPTION 'invalid_tracking_status';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF NOT v_driver.is_on_duty THEN
    RAISE EXCEPTION 'driver_off_duty' USING MESSAGE = 'Location tracking requires on-duty status';
  END IF;

  IF v_status = 'delivery_submit' AND p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  SELECT * INTO v_prev FROM public.driver_locations WHERE driver_id = v_uid;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity <= 0 THEN
    v_in_range := true;
    v_zone_status := 'unknown';
  ELSE
    v_in_range := public.driver_is_within_delivery_range(
      v_uid,
      p_latitude::double precision,
      p_longitude::double precision,
      v_proximity
    );
    v_zone_status := CASE WHEN v_in_range THEN 'in_zone' ELSE 'out_of_zone' END;
  END IF;

  v_is_moving := (
    v_status IN ('moving', 'delivery_submit')
    OR (p_speed_mps IS NOT NULL AND p_speed_mps >= 1)
  );

  IF v_prev.driver_id IS NOT NULL THEN
    IF (v_prev.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date = v_now_day THEN
      v_segment_m := public._haversine_meters(
        v_prev.latitude::double precision,
        v_prev.longitude::double precision,
        p_latitude::double precision,
        p_longitude::double precision
      );

      IF NOT v_is_moving THEN
        v_segment_m := 0;
      ELSIF v_segment_m < 0 OR v_segment_m > 500 THEN
        v_segment_m := 0;
      END IF;

      v_distance_today := COALESCE(v_prev.distance_today_meters, 0) + COALESCE(v_segment_m, 0);
    ELSE
      v_distance_today := 0;
    END IF;
  END IF;

  INSERT INTO public.driver_locations (
    driver_id,
    latitude,
    longitude,
    speed_mps,
    accuracy_meters,
    battery_pct,
    tracking_status,
    zone_status,
    distance_today_meters,
    last_seen_at,
    updated_at
  ) VALUES (
    v_uid,
    p_latitude,
    p_longitude,
    p_speed_mps,
    p_accuracy_meters,
    p_battery_pct,
    v_status,
    v_zone_status,
    v_distance_today,
    v_now,
    v_now
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    speed_mps = EXCLUDED.speed_mps,
    accuracy_meters = EXCLUDED.accuracy_meters,
    battery_pct = EXCLUDED.battery_pct,
    tracking_status = EXCLUDED.tracking_status,
    zone_status = EXCLUDED.zone_status,
    distance_today_meters = EXCLUDED.distance_today_meters,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at;

  SELECT *
  INTO v_last_event
  FROM public.driver_location_events
  WHERE driver_id = v_uid
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF p_force_history OR v_status = 'delivery_submit' THEN
    v_history_written := true;
  ELSIF v_last_event.id IS NULL THEN
    v_history_written := true;
  ELSIF v_last_event.tracking_status IS DISTINCT FROM v_status THEN
    v_history_written := true;
  ELSE
    v_dist_m := public._haversine_meters(
      v_last_event.latitude::double precision,
      v_last_event.longitude::double precision,
      p_latitude::double precision,
      p_longitude::double precision
    );
    v_secs_since_event := extract(epoch FROM (v_now - v_last_event.recorded_at));
    IF v_dist_m >= 75 OR v_secs_since_event >= 300 THEN
      v_history_written := true;
    END IF;
  END IF;

  IF v_history_written THEN
    INSERT INTO public.driver_location_events (
      driver_id,
      latitude,
      longitude,
      speed_mps,
      accuracy_meters,
      battery_pct,
      tracking_status,
      zone_status,
      delivery_id,
      recorded_at
    ) VALUES (
      v_uid,
      p_latitude,
      p_longitude,
      p_speed_mps,
      p_accuracy_meters,
      p_battery_pct,
      v_status,
      v_zone_status,
      p_delivery_id,
      v_now
    );
  END IF;

  SELECT * INTO v_attendance_row
  FROM public.driver_attendance da
  WHERE da.driver_id = v_uid
    AND da.attendance_date = v_now_day;

  IF FOUND AND v_attendance_row.first_online_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.driver_restaurants dr
      WHERE dr.driver_id = v_uid
    ) INTO v_has_restaurants;

    IF v_has_restaurants THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.driver_restaurants dr
        JOIN public.restaurants r ON r.id = dr.restaurant_id
        WHERE dr.driver_id = v_uid
          AND r.latitude IS NOT NULL
          AND r.longitude IS NOT NULL
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(p_longitude::double precision, p_latitude::double precision), 4326)::extensions.geography,
            ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::extensions.geography,
            GREATEST(v_proximity, 0)
          )
      ) INTO v_inside_restaurant;

      IF v_inside_restaurant THEN
        v_validation_source := 'restaurant';
        SELECT dr.restaurant_id
        INTO v_validation_ref
        FROM public.driver_restaurants dr
        JOIN public.restaurants r ON r.id = dr.restaurant_id
        WHERE dr.driver_id = v_uid
          AND r.latitude IS NOT NULL
          AND r.longitude IS NOT NULL
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(p_longitude::double precision, p_latitude::double precision), 4326)::extensions.geography,
            ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::extensions.geography,
            GREATEST(v_proximity, 0)
          )
        ORDER BY dr.restaurant_id
        LIMIT 1;
      END IF;
    ELSE
      IF v_driver.zone_id IS NOT NULL THEN
        SELECT * INTO v_zone_row FROM public.zones z WHERE z.id = v_driver.zone_id;
        IF FOUND THEN
          v_inside_zone := public._point_within_zone_proximity(
            p_latitude::double precision,
            p_longitude::double precision,
            v_zone_row.geometry,
            v_zone_row.zone_type,
            0
          );
          IF v_inside_zone THEN
            v_validation_source := 'zone';
            v_validation_ref := v_zone_row.id;
          END IF;
        END IF;
      END IF;
    END IF;

    UPDATE public.driver_attendance
    SET total_ping_count = total_ping_count + 1,
        valid_ping_count = valid_ping_count + CASE WHEN v_validation_source IS NULL THEN 0 ELSE 1 END,
        is_validated = is_validated OR v_validation_source IS NOT NULL,
        validated_at = CASE
          WHEN v_validation_source IS NOT NULL THEN COALESCE(validated_at, v_now)
          ELSE validated_at
        END,
        validation_source = CASE
          WHEN validation_source IS NULL THEN v_validation_source
          ELSE validation_source
        END,
        validation_ref_id = CASE
          WHEN validation_ref_id IS NULL THEN v_validation_ref
          ELSE validation_ref_id
        END,
        status = CASE
          WHEN status = 'present' OR v_validation_source IS NOT NULL THEN 'present'
          ELSE 'online_unvalidated'
        END,
        updated_at = v_now
    WHERE driver_id = v_uid
      AND attendance_date = v_now_day;
  END IF;

  RETURN jsonb_build_object(
    'zone_status', v_zone_status,
    'in_range', v_in_range,
    'last_seen_at', v_now,
    'history_written', v_history_written,
    'tracking_status', v_status,
    'speed_mps', p_speed_mps,
    'distance_today_meters', v_distance_today
  );
END;
$$;

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
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
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

CREATE OR REPLACE FUNCTION public.driver_get_attendance(
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_elapsed integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_present integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  IF v_today < v_start THEN
    v_elapsed := 0;
  ELSIF v_today > v_end THEN
    v_elapsed := extract(day FROM v_end)::integer;
  ELSE
    v_elapsed := extract(day FROM v_today)::integer;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'attendance_date', da.attendance_date,
        'online_seconds', da.online_seconds
          + CASE
            WHEN ds.is_online = true
              AND da.attendance_date = v_today
              AND da.last_online_at IS NOT NULL
            THEN GREATEST(0, extract(epoch FROM ((now()) - da.last_online_at))::integer)
            ELSE 0
          END,
        'status', da.status,
        'is_validated', da.is_validated,
        'validation_source', da.validation_source
      )
      ORDER BY da.attendance_date
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.driver_attendance da
  LEFT JOIN LATERAL (
    SELECT s.is_online
    FROM public.driver_sessions s
    WHERE s.driver_id = da.driver_id
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) ds ON true
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND v_end;

  SELECT count(*)::integer
  INTO v_present
  FROM public.driver_attendance da
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND LEAST(v_end, v_today)
    AND da.status = 'present';

  RETURN jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'present_days', v_present,
    'elapsed_days', v_elapsed,
    'rows', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_attendance_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_count integer := 0;
BEGIN
  UPDATE public.driver_attendance da
  SET online_seconds = da.online_seconds + GREATEST(
      0,
      extract(epoch FROM (v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)))::integer
    ),
    last_online_at = v_now,
    updated_at = v_now
  FROM public.driver_sessions ds
  WHERE ds.driver_id = da.driver_id
    AND ds.is_online = true
    AND da.attendance_date = v_today
    AND da.first_online_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_update_avatar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_attendance(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_attendance_stale_sessions() TO service_role;
