-- Close the two GPS audit gaps.
--
-- 1. Liveness during coalesced heartbeats.
--    The 8s/18m coalesce guard returns without writing anything, so a driver
--    whose app is running but stationary looks identical to a driver whose app
--    died. That is why driver 10085's 53-minute gap could not be explained.
--
--    IMPORTANT: a narrow "only two columns" UPDATE does NOT avoid the realtime
--    cost. driver_locations is in supabase_realtime and Postgres logical
--    replication ships the whole new row regardless of how many columns the
--    UPDATE touched - so writing on every coalesced call would restore exactly
--    the broadcast flood the coalesce guard was added to stop. The heartbeat
--    write is therefore throttled to 60s, which caps it below the existing
--    accepted-write rate while still answering "was the app alive" to the
--    minute.
--
-- 2. geofence_events had a schema and zero rows because nothing ever wrote to
--    it. driver_report_location already computes the in-zone/out-of-zone flip;
--    it just threw the transition away.

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS last_report_at timestamptz,
  ADD COLUMN IF NOT EXISTS coalesced_since_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.driver_locations.last_report_at IS
  'Last time the app reported any fix, including ones the coalesce guard discarded. Throttled to 60s granularity. Use this, not last_seen_at, to tell "app alive but stationary" from "app gone".';
COMMENT ON COLUMN public.driver_locations.coalesced_since_count IS
  'Throttled heartbeat writes since the last full position write, i.e. roughly how many minutes the app has been alive without moving. Reset to 0 on every real position write.';

-- Backfill so existing rows do not read as "never reported".
UPDATE public.driver_locations
SET last_report_at = last_seen_at
WHERE last_report_at IS NULL;

CREATE OR REPLACE FUNCTION public.driver_report_location(
  p_latitude numeric,
  p_longitude numeric,
  p_speed_mps numeric DEFAULT NULL::numeric,
  p_accuracy_meters numeric DEFAULT NULL::numeric,
  p_battery_pct smallint DEFAULT NULL::smallint,
  p_tracking_status text DEFAULT 'idle'::text,
  p_delivery_id uuid DEFAULT NULL::uuid,
  p_force_history boolean DEFAULT false,
  p_heading_deg numeric DEFAULT NULL::numeric,
  p_altitude_m numeric DEFAULT NULL::numeric,
  p_network_type text DEFAULT NULL::text,
  p_charging_state text DEFAULT NULL::text,
  p_is_mocked boolean DEFAULT NULL::boolean,
  p_location_provider text DEFAULT NULL::text,
  p_active_delivery_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
  v_dist_live double precision;
  v_secs_since_event double precision;
  v_secs_since_live double precision;
  v_status text := lower(trim(coalesce(p_tracking_status, 'idle')));
  v_segment_m double precision := 0;
  v_distance_today numeric(12, 2) := 0;
  v_is_moving boolean := false;
  v_geo_event text;
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

  -- Coalesce: skip UPSERT (+ realtime broadcast) for near-duplicates within 8s
  -- unless status/zone changed or driver moved ≥18m. Legitimate 10–15s moves still write.
  IF v_prev.driver_id IS NOT NULL
     AND NOT coalesce(p_force_history, false)
     AND v_status <> 'delivery_submit'
  THEN
    v_secs_since_live := extract(epoch FROM (v_now - v_prev.last_seen_at));
    v_dist_live := public._haversine_meters(
      v_prev.latitude::double precision,
      v_prev.longitude::double precision,
      p_latitude::double precision,
      p_longitude::double precision
    );
    IF v_secs_since_live < 8
       AND v_dist_live < 18
       AND v_prev.tracking_status IS NOT DISTINCT FROM v_status
       AND v_prev.zone_status IS NOT DISTINCT FROM v_zone_status
    THEN
      -- Alive but not worth a position write. Throttled to 60s; see the header
      -- note on why a narrower UPDATE would not have been cheaper.
      IF COALESCE(v_prev.last_report_at, v_prev.last_seen_at) < v_now - interval '60 seconds' THEN
        UPDATE public.driver_locations
        SET last_report_at = v_now,
            coalesced_since_count = COALESCE(coalesced_since_count, 0) + 1
        WHERE driver_id = v_uid;
      END IF;

      RETURN jsonb_build_object(
        'zone_status', coalesce(v_prev.zone_status, v_zone_status),
        'in_range', coalesce(v_prev.zone_status, v_zone_status) IS DISTINCT FROM 'out_of_zone',
        'last_seen_at', v_prev.last_seen_at,
        'history_written', false,
        'tracking_status', v_prev.tracking_status,
        'speed_mps', v_prev.speed_mps,
        'distance_today_meters', coalesce(v_prev.distance_today_meters, 0),
        'coalesced', true
      );
    END IF;
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
    heading_deg,
    altitude_m,
    network_type,
    charging_state,
    is_mocked,
    location_provider,
    active_delivery_id,
    tracking_status,
    zone_status,
    distance_today_meters,
    last_seen_at,
    last_report_at,
    coalesced_since_count,
    updated_at
  ) VALUES (
    v_uid,
    p_latitude,
    p_longitude,
    p_speed_mps,
    p_accuracy_meters,
    p_battery_pct,
    p_heading_deg,
    p_altitude_m,
    NULLIF(trim(p_network_type), ''),
    NULLIF(trim(p_charging_state), ''),
    p_is_mocked,
    NULLIF(trim(p_location_provider), ''),
    p_active_delivery_id,
    v_status,
    v_zone_status,
    v_distance_today,
    v_now,
    v_now,
    0,
    v_now
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    speed_mps = EXCLUDED.speed_mps,
    accuracy_meters = EXCLUDED.accuracy_meters,
    battery_pct = EXCLUDED.battery_pct,
    heading_deg = EXCLUDED.heading_deg,
    altitude_m = EXCLUDED.altitude_m,
    network_type = EXCLUDED.network_type,
    charging_state = EXCLUDED.charging_state,
    is_mocked = EXCLUDED.is_mocked,
    location_provider = EXCLUDED.location_provider,
    active_delivery_id = EXCLUDED.active_delivery_id,
    tracking_status = EXCLUDED.tracking_status,
    zone_status = EXCLUDED.zone_status,
    distance_today_meters = EXCLUDED.distance_today_meters,
    last_seen_at = EXCLUDED.last_seen_at,
    last_report_at = EXCLUDED.last_report_at,
    coalesced_since_count = 0,
    updated_at = EXCLUDED.updated_at;

  -- Geofence crossings. 'unknown' means proximity checking is switched off
  -- entirely, so transitions into or out of it are configuration changes, not
  -- movement, and a first-ever fix can only ever be an entry.
  IF v_prev.zone_status IS DISTINCT FROM v_zone_status THEN
    IF v_prev.zone_status = 'out_of_zone' AND v_zone_status = 'in_zone' THEN
      v_geo_event := 'entry';
    ELSIF v_prev.zone_status = 'in_zone' AND v_zone_status = 'out_of_zone' THEN
      v_geo_event := 'exit';
    ELSIF v_prev.zone_status IS NULL AND v_zone_status = 'in_zone' THEN
      v_geo_event := 'entry';
    END IF;
  END IF;

  IF v_geo_event IS NOT NULL THEN
    INSERT INTO public.geofence_events (
      zone_id, driver_id, event_type, latitude, longitude,
      accuracy_meters, source, occurred_at, metadata
    ) VALUES (
      v_driver.zone_id, v_uid, v_geo_event, p_latitude, p_longitude,
      p_accuracy_meters, 'tracking', v_now,
      -- zone_status is derived from restaurant delivery geofences, not from the
      -- driver's assigned zone polygon; zone_id is recorded for context only.
      jsonb_build_object(
        'basis', 'delivery_range',
        'from', v_prev.zone_status,
        'to', v_zone_status,
        'proximity_meters', v_proximity
      )
    );

    PERFORM public.log_driver_operation(
      v_uid, 'location',
      CASE WHEN v_geo_event = 'entry' THEN 'location.zone_entry' ELSE 'location.zone_exit' END,
      'rpc', 'driver_report_location', true, NULL, 'zone', v_driver.zone_id,
      jsonb_build_object('from', v_prev.zone_status, 'to', v_zone_status),
      p_latitude, p_longitude
    );
  END IF;

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
      heading_deg,
      altitude_m,
      network_type,
      charging_state,
      is_mocked,
      location_provider,
      active_delivery_id,
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
      p_heading_deg,
      p_altitude_m,
      NULLIF(trim(p_network_type), ''),
      NULLIF(trim(p_charging_state), ''),
      p_is_mocked,
      NULLIF(trim(p_location_provider), ''),
      p_active_delivery_id,
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
    'tracking_status', v_status,
    'speed_mps', p_speed_mps,
    'distance_today_meters', v_distance_today,
    'coalesced', false
  );
END;
$function$;
