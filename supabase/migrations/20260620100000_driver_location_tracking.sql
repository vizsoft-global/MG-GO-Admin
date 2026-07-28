-- Driver GPS tracking: live upsert table + sampled history + report RPC.
-- Realtime enabled on driver_locations for admin live map.

CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  speed_mps numeric(8, 3),
  accuracy_meters numeric(8, 2),
  battery_pct smallint,
  heading_deg numeric(6, 2),
  tracking_status text NOT NULL,
  zone_status text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_locations_tracking_status_check CHECK (
    tracking_status IN ('idle', 'moving', 'delivery_submit')
  ),
  CONSTRAINT driver_locations_zone_status_check CHECK (
    zone_status IS NULL OR zone_status IN ('in_zone', 'out_of_zone', 'unknown')
  ),
  CONSTRAINT driver_locations_battery_check CHECK (
    battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)
  )
);

CREATE TABLE IF NOT EXISTS public.driver_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  speed_mps numeric(8, 3),
  accuracy_meters numeric(8, 2),
  battery_pct smallint,
  tracking_status text NOT NULL,
  zone_status text,
  delivery_id uuid REFERENCES public.deliveries(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_location_events_tracking_status_check CHECK (
    tracking_status IN ('idle', 'moving', 'delivery_submit')
  ),
  CONSTRAINT driver_location_events_battery_check CHECK (
    battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)
  )
);

CREATE INDEX IF NOT EXISTS driver_location_events_driver_recorded_idx
  ON public.driver_location_events (driver_id, recorded_at DESC);

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_location_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_locations_own_all ON public.driver_locations;
CREATE POLICY driver_locations_own_all ON public.driver_locations
  FOR ALL TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS staff_read_driver_locations ON public.driver_locations;
CREATE POLICY staff_read_driver_locations ON public.driver_locations
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_location_events_own_insert ON public.driver_location_events;
CREATE POLICY driver_location_events_own_insert ON public.driver_location_events
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_location_events_own_select ON public.driver_location_events;
CREATE POLICY driver_location_events_own_select ON public.driver_location_events
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS staff_read_driver_location_events ON public.driver_location_events;
CREATE POLICY staff_read_driver_location_events ON public.driver_location_events
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

-- Haversine distance in meters (for history sampling).
CREATE OR REPLACE FUNCTION public._haversine_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6371000.0 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
    * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
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
  v_dist_m double precision;
  v_secs_since_event double precision;
  v_status text := lower(trim(coalesce(p_tracking_status, 'idle')));
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

  INSERT INTO public.driver_locations (
    driver_id,
    latitude,
    longitude,
    speed_mps,
    accuracy_meters,
    battery_pct,
    tracking_status,
    zone_status,
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

  RETURN jsonb_build_object(
    'zone_status', v_zone_status,
    'in_range', v_in_range,
    'last_seen_at', v_now,
    'history_written', v_history_written,
    'tracking_status', v_status
  );
END;
$$;

-- Clear live location when driver goes off duty.
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
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = p_is_on_duty,
      updated_at = now()
  WHERE id = v_driver_id;

  IF NOT p_is_on_duty THEN
    DELETE FROM public.driver_locations WHERE driver_id = v_driver_id;
  END IF;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, now());
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status)
    VALUES (v_driver_id, v_log_date, now(), 'present')
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          status = CASE
            WHEN attendance_logs.status = 'on_leave' THEN attendance_logs.status
            ELSE 'present'
          END,
          updated_at = now();
  ELSE
    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = now(),
          updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = now(),
        updated_at = now()
    WHERE driver_id = v_driver_id
      AND log_date = v_log_date
      AND check_out_at IS NULL;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;

GRANT EXECUTE ON FUNCTION public.driver_report_location(
  numeric, numeric, numeric, numeric, smallint, text, uuid, boolean
) TO authenticated;
