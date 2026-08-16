-- An open delivery is a fact about `deliveries`, and "distance today" is one number.
--
-- Two defects, both traceable to trusting values a phone attached to a position fix.
--
-- 1) On Delivery was practically unreachable. `driver_locations.active_delivery_id` is
--    whatever the last fix carried, and the driver app's foreground service usually
--    carries nothing: it reads the delivery id from a `SharedPreferences` cache
--    belonging to a different isolate than the one that stored it. So a rider with an
--    open pickup showed as Idle or Moving. The open delivery is already recorded
--    properly in `deliveries` (`status = 'in_transit'`), so the snapshot reads it from
--    there. That also fixes the opposite error — a stale id left on the pin outliving
--    its delivery, which would now pin a driver to On Delivery indefinitely, since the
--    V2 status machine leans on this field alone.
--
-- 2) The driver rail said 4.6 km where Route Today said 3.5 km, and on one driver today
--    65.7 km against 7.1 km. The odometer was counting fiction: `distance_today_meters`
--    adds the displacement of every reported fix, and Android's **network** provider
--    reports `accuracy_meters` of exactly 100 from a cell tower that can be 600m from
--    the rider. A phone alternating providers therefore logs a few hundred metres of
--    "travel" every couple of seconds without moving — 95 coarse fixes in that driver's
--    history account for the whole 58 km gap. Both writers now refuse a segment that
--    touches a coarse fix or that implies more than 40 m/s, which is the same pair of
--    rules the route already used, so the odometer measures travel again.
--
--    With the odometer trustworthy, the two surfaces are reconciled by *sharing* it:
--    for today, `admin_get_driver_day_route` reports the stored odometer rather than
--    re-deriving a second figure from the sampled history. Deriving it in the snapshot
--    instead was the other option and was rejected on cost — history is written at 75m
--    spacing, so a 500-rider day is ~350k rows, and the snapshot is called every 60s by
--    the room and every 10s per client by the polling rail. The odometer is maintained
--    in O(1) per fix by code that already holds both endpoints.
--
--    A past day keeps the sampled sum: the odometer only holds today, and a
--    75m-simplified polyline is the only record left of last week.
--
-- 50m is the coarse threshold everywhere (here, `COARSE_FIX_ACCURACY_M` in the fleet
-- room, `coarseGpsAccuracyMeters` in the app): comfortably above a real GPS fix in an
-- urban canyon (~20-40m) and below every coarse fix observed in production.
--
-- Today's already-accumulated `distance_today_meters` is re-seeded at the end of this
-- file, but only for drivers whose history proves a coarse fix today — see the note there
-- for why a comparison against the sampled sum cannot be the test.

-- ---------------------------------------------------------------------------
-- driver_report_location — the app's direct path (and v1's writer).
--
-- Unchanged except for the odometer gate. Reproduced in full because the body is
-- CREATE OR REPLACE; the diff against 20260908200000 is the segment block only.
-- ---------------------------------------------------------------------------
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
    RAISE EXCEPTION 'driver_off_duty' USING DETAIL = 'Location tracking requires on-duty status';
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
      v_secs_since_live := extract(epoch FROM (v_now - v_prev.last_seen_at));

      /*
       * A segment only counts as travel if both ends are believable.
       *
       * The accuracy tests are the fix for a 65 km day logged by a rider who stayed
       * inside one block: a coarse network fix sits hundreds of metres from the GPS
       * position, so alternating providers manufactured distance every few seconds. The
       * speed test catches the same hop when the accuracy is not reported. Both mirror
       * admin_get_driver_day_route, so the odometer and the route agree about what
       * counts. NULL accuracy is treated as fine — pre-fusion builds do not report it,
       * and refusing those would zero their odometer.
       */
      IF NOT v_is_moving THEN
        v_segment_m := 0;
      ELSIF v_segment_m IS NULL OR v_segment_m < 0 OR v_segment_m > 500 THEN
        v_segment_m := 0;
      ELSIF COALESCE(p_accuracy_meters, 0) > 50
         OR COALESCE(v_prev.accuracy_meters, 0) > 50 THEN
        v_segment_m := 0;
      ELSIF v_secs_since_live IS NOT NULL
        AND v_secs_since_live > 0
        AND v_segment_m / v_secs_since_live > 40 THEN
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

COMMENT ON FUNCTION public.driver_report_location(numeric, numeric, numeric, numeric, smallint, text, uuid, boolean, numeric, numeric, text, text, boolean, text, uuid) IS
  'Driver live position + sampled history. distance_today_meters ignores segments touching a coarse (>50m) fix or implying >40 m/s.';

-- ---------------------------------------------------------------------------
-- admin_ingest_driver_positions(p_events jsonb) — the edge hub's batch writer.
--
-- Same odometer gate. The batch walks a driver's points in client-timestamp order,
-- so the "previous" fix for a segment is either the stored pin or the point before
-- it in this batch; the accuracy and timestamp of that point now travel alongside
-- its coordinates for exactly this test.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ingest_driver_positions(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_now_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_proximity integer;
  v_total integer;
  v_point record;
  v_driver public.drivers%ROWTYPE;
  v_prev public.driver_locations%ROWTYPE;
  v_last_event public.driver_location_events%ROWTYPE;

  v_cur_driver uuid;
  v_driver_ok boolean := false;
  v_has_prev boolean := false;

  v_distance_today numeric(12, 2) := 0;
  v_prev_lat double precision;
  v_prev_lng double precision;
  v_prev_acc numeric;
  v_prev_at timestamptz;
  v_segment_m double precision;
  v_segment_secs double precision;
  v_is_moving boolean;

  -- Rolling "last history row written" marker, seeded from the table then advanced
  -- in memory so several points in one batch sample correctly against each other.
  v_le_at timestamptz;
  v_le_lat double precision;
  v_le_lng double precision;
  v_le_status text;

  v_in_range boolean;
  v_zone_status text;
  v_recorded_at timestamptz;
  v_write_history boolean;
  v_dist_m double precision;
  v_secs double precision;
  v_geo_event text;
  v_coalesce_skip boolean;

  v_accepted integer := 0;
  v_live_updates integer := 0;
  v_history_rows integer := 0;
  v_replay_rows integer := 0;
  v_coalesced integer := 0;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._fleet_caller_is_service_role() THEN
    -- Belt and braces: EXECUTE is granted to service_role only, but a future
    -- CREATE OR REPLACE that forgets the grants should still fail closed.
    IF NOT public.is_admin_panel_user() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
    END IF;
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'events_array_required');
  END IF;

  v_total := jsonb_array_length(p_events);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'accepted', 0, 'invalid', 0);
  END IF;
  IF v_total > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_too_large', 'received', v_total);
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;
  v_proximity := COALESCE(v_proximity, 500);

  FOR v_point IN
    WITH parsed AS (
      SELECT
        t.ord,
        NULLIF(t.e ->> 'driver_id', '')::uuid AS driver_id,
        NULLIF(t.e ->> 'lat', '')::numeric AS lat,
        NULLIF(t.e ->> 'lng', '')::numeric AS lng,
        NULLIF(t.e ->> 'speed_mps', '')::numeric AS speed_mps,
        NULLIF(t.e ->> 'accuracy_m', '')::numeric AS accuracy_m,
        NULLIF(t.e ->> 'heading_deg', '')::numeric AS heading_deg,
        NULLIF(t.e ->> 'battery_pct', '')::smallint AS battery_pct,
        NULLIF(t.e ->> 'altitude_m', '')::numeric AS altitude_m,
        NULLIF(trim(t.e ->> 'network_type'), '') AS network_type,
        NULLIF(trim(t.e ->> 'charging_state'), '') AS charging_state,
        CASE WHEN t.e ? 'is_mocked' THEN (t.e ->> 'is_mocked')::boolean END AS is_mocked,
        NULLIF(trim(t.e ->> 'location_provider'), '') AS location_provider,
        NULLIF(t.e ->> 'active_delivery_id', '')::uuid AS active_delivery_id,
        NULLIF(t.e ->> 'delivery_id', '')::uuid AS delivery_id,
        lower(trim(COALESCE(t.e ->> 'tracking_status', 'idle'))) AS tracking_status,
        COALESCE(NULLIF(t.e ->> 'client_ts', '')::timestamptz, v_now) AS client_ts,
        COALESCE(NULLIF(t.e ->> 'replay', '')::boolean, false) AS replay
      FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, ord)
    ),
    valid AS (
      SELECT *
      FROM parsed
      WHERE driver_id IS NOT NULL
        AND lat IS NOT NULL
        AND lng IS NOT NULL
        AND lat BETWEEN -90 AND 90
        AND lng BETWEEN -180 AND 180
        AND tracking_status IN ('idle', 'moving', 'delivery_submit')
        AND client_ts <= v_now + interval '5 minutes'
        AND client_ts >= v_now - interval '7 days'
    )
    SELECT
      v.*,
      row_number() OVER (
        PARTITION BY v.driver_id, v.replay ORDER BY v.client_ts, v.ord
      ) AS grp_seq,
      count(*) OVER (PARTITION BY v.driver_id, v.replay) AS grp_count
    FROM valid v
    -- replay = false sorts first, so the live pass for a driver completes before
    -- its backfill rows are touched.
    ORDER BY v.driver_id, v.replay, v.client_ts, v.ord
  LOOP
    IF v_point.driver_id IS DISTINCT FROM v_cur_driver THEN
      v_cur_driver := v_point.driver_id;

      SELECT * INTO v_driver FROM public.drivers WHERE id = v_cur_driver;
      v_driver_ok := FOUND AND v_driver.archived_at IS NULL;

      IF NOT v_driver_ok THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object('driver_id', v_cur_driver, 'reason', 'unknown_driver')
        );
      END IF;

      SELECT * INTO v_prev FROM public.driver_locations WHERE driver_id = v_cur_driver;
      v_has_prev := FOUND;

      IF v_has_prev AND (v_prev.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date = v_now_day THEN
        v_distance_today := COALESCE(v_prev.distance_today_meters, 0);
        v_prev_lat := v_prev.latitude::double precision;
        v_prev_lng := v_prev.longitude::double precision;
        v_prev_acc := v_prev.accuracy_meters;
        v_prev_at := v_prev.last_seen_at;
      ELSE
        v_distance_today := 0;
        v_prev_lat := NULL;
        v_prev_lng := NULL;
        v_prev_acc := NULL;
        v_prev_at := NULL;
      END IF;

      SELECT * INTO v_last_event
      FROM public.driver_location_events
      WHERE driver_id = v_cur_driver
      ORDER BY recorded_at DESC
      LIMIT 1;

      IF FOUND THEN
        v_le_at := v_last_event.recorded_at;
        v_le_lat := v_last_event.latitude::double precision;
        v_le_lng := v_last_event.longitude::double precision;
        v_le_status := v_last_event.tracking_status;
      ELSE
        v_le_at := NULL;
        v_le_lat := NULL;
        v_le_lng := NULL;
        v_le_status := NULL;
      END IF;
    END IF;

    v_accepted := v_accepted + 1;

    IF NOT v_driver_ok THEN
      CONTINUE;
    END IF;

    -- Backfill: history only, keyed on the client timestamp, idempotent so a
    -- retried batch cannot duplicate the trail.
    IF v_point.replay THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.driver_location_events
        WHERE driver_id = v_cur_driver AND recorded_at = v_point.client_ts
      ) THEN
        INSERT INTO public.driver_location_events (
          driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct,
          heading_deg, altitude_m, network_type, charging_state, is_mocked,
          location_provider, active_delivery_id, tracking_status, zone_status,
          delivery_id, recorded_at
        ) VALUES (
          v_cur_driver, v_point.lat, v_point.lng, v_point.speed_mps, v_point.accuracy_m,
          v_point.battery_pct, v_point.heading_deg, v_point.altitude_m, v_point.network_type,
          v_point.charging_state, v_point.is_mocked, v_point.location_provider,
          v_point.active_delivery_id, v_point.tracking_status,
          -- The proximity verdict at the time is unknowable now; claiming one would
          -- be a fabrication, so it stays NULL.
          NULL,
          v_point.delivery_id, v_point.client_ts
        );
        v_replay_rows := v_replay_rows + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Live points require on duty, matching driver_report_location's
    -- driver_off_duty guard. Reported back so the DO can evict the entity.
    IF NOT v_driver.is_on_duty THEN
      IF v_point.grp_seq = 1 THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object('driver_id', v_cur_driver, 'reason', 'off_duty')
        );
      END IF;
      CONTINUE;
    END IF;

    IF v_proximity <= 0 THEN
      v_in_range := true;
      v_zone_status := 'unknown';
    ELSE
      v_in_range := public.driver_is_within_delivery_range(
        v_cur_driver,
        v_point.lat::double precision,
        v_point.lng::double precision,
        v_proximity
      );
      v_zone_status := CASE WHEN v_in_range THEN 'in_zone' ELSE 'out_of_zone' END;
    END IF;

    v_is_moving := (
      v_point.tracking_status IN ('moving', 'delivery_submit')
      OR (v_point.speed_mps IS NOT NULL AND v_point.speed_mps >= 1)
    );

    IF v_prev_lat IS NOT NULL THEN
      v_segment_m := public._haversine_meters(
        v_prev_lat, v_prev_lng,
        v_point.lat::double precision, v_point.lng::double precision
      );
      v_segment_secs := extract(epoch FROM (v_point.client_ts - COALESCE(v_prev_at, v_point.client_ts)));

      -- Same believability rules as driver_report_location and the day route: a
      -- segment touching a coarse fix, or implying >40 m/s, is provider noise.
      IF NOT v_is_moving THEN
        v_segment_m := 0;
      ELSIF v_segment_m IS NULL OR v_segment_m < 0 OR v_segment_m > 500 THEN
        v_segment_m := 0;
      ELSIF COALESCE(v_point.accuracy_m, 0) > 50 OR COALESCE(v_prev_acc, 0) > 50 THEN
        v_segment_m := 0;
      ELSIF v_segment_secs IS NOT NULL
        AND v_segment_secs > 0
        AND v_segment_m / v_segment_secs > 40 THEN
        v_segment_m := 0;
      END IF;

      v_distance_today := v_distance_today + COALESCE(v_segment_m, 0);
    END IF;
    v_prev_lat := v_point.lat::double precision;
    v_prev_lng := v_point.lng::double precision;
    v_prev_acc := v_point.accuracy_m;
    v_prev_at := v_point.client_ts;

    -- History uses the client timestamp so the day route keeps its real spacing,
    -- clamped so a skewed device clock cannot write the future or ancient history.
    v_recorded_at := GREATEST(
      LEAST(v_point.client_ts, v_now),
      v_now - interval '15 minutes'
    );

    v_write_history := false;
    IF v_point.tracking_status = 'delivery_submit' THEN
      v_write_history := true;
    ELSIF v_le_at IS NULL THEN
      v_write_history := true;
    ELSIF v_le_status IS DISTINCT FROM v_point.tracking_status THEN
      v_write_history := true;
    ELSE
      v_dist_m := public._haversine_meters(
        v_le_lat, v_le_lng,
        v_point.lat::double precision, v_point.lng::double precision
      );
      v_secs := extract(epoch FROM (v_recorded_at - v_le_at));
      IF COALESCE(v_dist_m, 0) >= 75 OR v_secs >= 300 THEN
        v_write_history := true;
      END IF;
    END IF;

    IF v_write_history AND NOT EXISTS (
      SELECT 1 FROM public.driver_location_events
      WHERE driver_id = v_cur_driver AND recorded_at = v_recorded_at
    ) THEN
      INSERT INTO public.driver_location_events (
        driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct,
        heading_deg, altitude_m, network_type, charging_state, is_mocked,
        location_provider, active_delivery_id, tracking_status, zone_status,
        delivery_id, recorded_at
      ) VALUES (
        v_cur_driver, v_point.lat, v_point.lng, v_point.speed_mps, v_point.accuracy_m,
        v_point.battery_pct, v_point.heading_deg, v_point.altitude_m, v_point.network_type,
        v_point.charging_state, v_point.is_mocked, v_point.location_provider,
        v_point.active_delivery_id, v_point.tracking_status, v_zone_status,
        v_point.delivery_id, v_recorded_at
      );
      v_history_rows := v_history_rows + 1;
      v_le_at := v_recorded_at;
      v_le_lat := v_point.lat::double precision;
      v_le_lng := v_point.lng::double precision;
      v_le_status := v_point.tracking_status;
    END IF;

    -- Only the newest point of the batch moves the pin: one UPSERT, therefore one
    -- realtime broadcast per driver per flush.
    CONTINUE WHEN v_point.grp_seq <> v_point.grp_count;

    v_coalesce_skip := false;
    IF v_has_prev AND v_point.tracking_status <> 'delivery_submit' THEN
      v_secs := extract(epoch FROM (v_now - v_prev.last_seen_at));
      v_dist_m := public._haversine_meters(
        v_prev.latitude::double precision, v_prev.longitude::double precision,
        v_point.lat::double precision, v_point.lng::double precision
      );
      IF v_secs < 8
         AND COALESCE(v_dist_m, 0) < 18
         AND v_prev.tracking_status IS NOT DISTINCT FROM v_point.tracking_status
         AND v_prev.zone_status IS NOT DISTINCT FROM v_zone_status
      THEN
        v_coalesce_skip := true;
        IF COALESCE(v_prev.last_report_at, v_prev.last_seen_at) < v_now - interval '60 seconds' THEN
          UPDATE public.driver_locations
          SET last_report_at = v_now,
              coalesced_since_count = COALESCE(coalesced_since_count, 0) + 1
          WHERE driver_id = v_cur_driver;
        END IF;
        v_coalesced := v_coalesced + 1;
      END IF;
    END IF;

    IF NOT v_coalesce_skip THEN
      INSERT INTO public.driver_locations (
        driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct,
        heading_deg, altitude_m, network_type, charging_state, is_mocked,
        location_provider, active_delivery_id, tracking_status, zone_status,
        distance_today_meters, last_seen_at, last_report_at, coalesced_since_count,
        updated_at
      ) VALUES (
        v_cur_driver, v_point.lat, v_point.lng, v_point.speed_mps, v_point.accuracy_m,
        v_point.battery_pct, v_point.heading_deg, v_point.altitude_m, v_point.network_type,
        v_point.charging_state, v_point.is_mocked, v_point.location_provider,
        v_point.active_delivery_id, v_point.tracking_status, v_zone_status,
        v_distance_today, v_now, v_now, 0, v_now
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

      v_live_updates := v_live_updates + 1;

      -- Same geofence semantics as driver_report_location: 'unknown' means proximity
      -- checking is switched off, so moving into or out of it is a configuration
      -- change and not a crossing.
      v_geo_event := NULL;
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
          v_driver.zone_id, v_cur_driver, v_geo_event, v_point.lat, v_point.lng,
          v_point.accuracy_m, 'fleet_edge', v_now,
          jsonb_build_object(
            'basis', 'delivery_range',
            'from', v_prev.zone_status,
            'to', v_zone_status,
            'proximity_meters', v_proximity
          )
        );

        PERFORM public.log_driver_operation(
          v_cur_driver, 'location',
          CASE WHEN v_geo_event = 'entry' THEN 'location.zone_entry' ELSE 'location.zone_exit' END,
          'rpc', 'admin_ingest_driver_positions', true, NULL, 'zone', v_driver.zone_id,
          jsonb_build_object('from', v_prev.zone_status, 'to', v_zone_status, 'via', 'edge'),
          v_point.lat, v_point.lng
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'received', v_total,
    'accepted', v_accepted,
    'invalid', v_total - v_accepted,
    'live_updates', v_live_updates,
    'coalesced', v_coalesced,
    'history_rows', v_history_rows,
    'replay_rows', v_replay_rows,
    'skipped', v_skipped,
    'server_time', v_now
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_ingest_driver_positions(jsonb) IS
  'Service-role batch position ingest for the Live Tracking V2 edge hub. Mirrors driver_report_location rules, including the coarse-fix and >40 m/s odometer gate; replay rows write history only.';

REVOKE ALL ON FUNCTION public.admin_ingest_driver_positions(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ingest_driver_positions(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_ingest_driver_positions(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ingest_driver_positions(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- admin_live_fleet_snapshot(p_seen_within_minutes int default 30)
--
-- Only active_delivery_id changes: it comes from `deliveries`, not from the pin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_live_fleet_snapshot(
  p_seen_within_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_cutoff timestamptz;
  v_drivers jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cutoff := v_now - make_interval(mins => GREATEST(COALESCE(p_seen_within_minutes, 30), 1));

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_seen_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_drivers
  FROM (
    SELECT
      d.id AS driver_id,
      COALESCE(NULLIF(trim(p.full_name), ''), d.driver_code) AS driver_name,
      d.driver_code,
      d.employee_id,
      d.avatar_object_key,
      d.avatar_updated_at,
      p.avatar_url,
      p.phone,
      d.status::text AS account_status,
      d.is_on_duty,
      d.is_blocked,
      d.zone_id,
      z.name AS zone_name,
      z.color AS zone_color,
      d.partner_id,
      pa.name AS partner_name,
      d.restaurant_id,
      r.name AS restaurant_name,
      d.vehicle_id,
      v.reg_number AS vehicle_reg_number,
      v.bike_id AS vehicle_bike_id,
      dl.latitude,
      dl.longitude,
      dl.speed_mps,
      dl.heading_deg,
      dl.accuracy_meters,
      dl.battery_pct,
      dl.is_mocked,
      dl.tracking_status,
      dl.zone_status,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      -- Deliberately NOT dl.active_delivery_id, which is only as fresh as whatever
      -- the phone last attached to a fix — usually nothing.
      open_delivery.id AS active_delivery_id,
      dl.last_seen_at,
      dl.last_report_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id AND ds.is_online
      ) AS is_online,
      (
        SELECT al.check_in_at
        FROM public.attendance_logs al
        WHERE al.driver_id = d.id AND al.log_date = v_day
        ORDER BY al.check_in_at DESC NULLS LAST
        LIMIT 1
      ) AS on_duty_since,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.status <> 'cancelled'
          AND (dv.created_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_today,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.delivered_at IS NOT NULL
          AND (dv.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_completed_today,
      sh.shift
    FROM public.drivers d
    JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    LEFT JOIN public.partners pa ON pa.id = d.partner_id
    LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    -- The open pickup. Newest wins: `active_pickup_exists` already keeps this to one
    -- row per driver, but ordering means a historical data repair cannot make it
    -- ambiguous.
    LEFT JOIN LATERAL (
      SELECT dv.id
      FROM public.deliveries dv
      WHERE dv.driver_id = d.id
        AND dv.status = 'in_transit'
      ORDER BY dv.pickup_at DESC NULLS LAST, dv.created_at DESC
      LIMIT 1
    ) open_delivery ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'shift_date', s.shift_date,
        'shift_type', s.shift_type,
        'session1_start_at',
          ((s.shift_date + s.session1_start)::timestamp AT TIME ZONE 'Asia/Kuwait'),
        'session1_end_at',
          (((s.shift_date + COALESCE(s.session1_end_day_offset, 0)) + s.session1_end)::timestamp
            AT TIME ZONE 'Asia/Kuwait'),
        'session2_start_at',
          CASE WHEN s.session2_start IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_start_day_offset, 0)) + s.session2_start)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'session2_end_at',
          CASE WHEN s.session2_end IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_end_day_offset, 0)) + s.session2_end)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'submitted_at', s.submitted_at
      ) AS shift
      FROM public.driver_daily_shifts s
      WHERE s.driver_id = d.id AND s.shift_date = v_day
      LIMIT 1
    ) sh ON true
    WHERE d.archived_at IS NULL
      AND (
        d.is_on_duty
        OR d.is_blocked
        OR dl.last_seen_at >= v_cutoff
        OR open_delivery.id IS NOT NULL
      )
  ) x;

  RETURN jsonb_build_object(
    'generated_at', v_now,
    'kuwait_day', v_day,
    'settings', public._fleet_settings(),
    'drivers', v_drivers
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_live_fleet_snapshot(integer) IS
  'One-shot Live Tracking V2 roster + last position. active_delivery_id comes from deliveries.status = in_transit, not from the live pin.';

GRANT EXECUTE ON FUNCTION public.admin_live_fleet_snapshot(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_get_driver_day_route(p_driver_id, p_date, p_tolerance_m)
--
-- Two changes:
--   * coarse fixes are excluded from the trail, so the polyline stops zig-zagging
--     between a GPS position and a cell tower 600m away;
--   * for today, `distance_m` is the stored odometer, so the number under the map is
--     the same number on the driver card. A past day still gets the sampled sum
--     (`sampled_distance_m` always carries it, for both).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_driver_day_route(
  p_driver_id uuid,
  p_date date DEFAULT NULL,
  p_tolerance_m numeric DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_day date := COALESCE(p_date, v_today);
  v_from timestamptz := (v_day::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_to timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_tolerance double precision := GREATEST(COALESCE(p_tolerance_m, 8), 0)::double precision;
  v_odometer numeric;
  v_result jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id_required';
  END IF;

  IF v_day = v_today THEN
    SELECT dl.distance_today_meters
    INTO v_odometer
    FROM public.driver_locations dl
    WHERE dl.driver_id = p_driver_id
      AND (dl.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date = v_today;
  END IF;

  WITH pts AS (
    SELECT
      row_number() OVER (ORDER BY e.recorded_at, e.id) AS idx,
      e.latitude, e.longitude, e.speed_mps, e.battery_pct, e.accuracy_meters,
      e.heading_deg, e.tracking_status, e.zone_status, e.active_delivery_id,
      e.recorded_at
    FROM public.driver_location_events e
    WHERE e.driver_id = p_driver_id
      AND e.recorded_at >= v_from
      AND e.recorded_at < v_to
      -- A coarse fix is a claim about a cell tower, not about the rider.
      AND (e.accuracy_meters IS NULL OR e.accuracy_meters <= 50)
  ),
  stats AS (
    SELECT
      count(*) AS total,
      COALESCE(extract(epoch FROM (max(recorded_at) - min(recorded_at))), 0) AS duration_s
    FROM pts
  ),
  -- Segment distance over the *full* set, ignoring implausible jumps: >40 m/s
  -- between fixes is a GPS glitch, not travel.
  windowed AS (
    SELECT
      lag(latitude::double precision) OVER (ORDER BY idx) AS prev_lat,
      lag(longitude::double precision) OVER (ORDER BY idx) AS prev_lng,
      latitude::double precision AS cur_lat,
      longitude::double precision AS cur_lng,
      GREATEST(
        extract(epoch FROM (recorded_at - lag(recorded_at) OVER (ORDER BY idx))),
        0.001
      ) AS gap_s
    FROM pts
  ),
  dist AS (
    SELECT COALESCE(sum(
      CASE
        WHEN prev_lat IS NULL THEN 0
        WHEN public._haversine_meters(prev_lat, prev_lng, cur_lat, cur_lng) / gap_s > 40 THEN 0
        ELSE public._haversine_meters(prev_lat, prev_lng, cur_lat, cur_lng)
      END
    ), 0) AS distance_m
    FROM windowed
  ),
  line AS (
    SELECT ST_Simplify(
      ST_Transform(
        ST_SetSRID(
          ST_MakeLine(
            ST_MakePointM(longitude::double precision, latitude::double precision, idx)
            ORDER BY idx
          ),
          4326
        ),
        32639  -- UTM 39N: metric, and Kuwait sits inside it
      ),
      v_tolerance
    ) AS g
    FROM pts
    WHERE (SELECT total FROM stats) >= 3 AND v_tolerance > 0
  ),
  kept AS (
    SELECT DISTINCT ST_M((dp).geom)::bigint AS idx
    FROM line, ST_DumpPoints(line.g) AS dp
    UNION
    -- Too short to simplify, or simplification switched off: keep everything.
    SELECT idx FROM pts WHERE (SELECT total FROM stats) < 3 OR v_tolerance <= 0
  ),
  kept_points AS (
    SELECT p.* FROM pts p JOIN kept k ON k.idx = p.idx
  ),
  -- A stop is a run of fixes inside 60m spanning at least 3 minutes.
  marked AS (
    SELECT
      idx, latitude, longitude, recorded_at,
      CASE
        WHEN lag(latitude) OVER (ORDER BY idx) IS NULL THEN 1
        WHEN public._haversine_meters(
               lag(latitude::double precision) OVER (ORDER BY idx),
               lag(longitude::double precision) OVER (ORDER BY idx),
               latitude::double precision,
               longitude::double precision
             ) > 60 THEN 1
        ELSE 0
      END AS is_break
    FROM pts
  ),
  grouped AS (
    SELECT marked.*, sum(is_break) OVER (ORDER BY idx) AS grp FROM marked
  ),
  runs AS (
    SELECT
      round(avg(latitude), 6) AS latitude,
      round(avg(longitude), 6) AS longitude,
      min(recorded_at) AS arrived_at,
      max(recorded_at) AS departed_at,
      count(*) AS fixes,
      extract(epoch FROM (max(recorded_at) - min(recorded_at)))::integer AS seconds
    FROM grouped
    GROUP BY grp
    HAVING extract(epoch FROM (max(recorded_at) - min(recorded_at))) >= 180
  ),
  dels AS (
    SELECT dv.id AS delivery_id, dv.external_order_id, dv.status::text AS status,
           'pickup' AS kind, dv.pickup_lat AS latitude, dv.pickup_lng AS longitude,
           dv.pickup_at AS at, r.name AS restaurant_name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.pickup_at >= v_from AND dv.pickup_at < v_to
      AND dv.pickup_lat IS NOT NULL AND dv.pickup_lng IS NOT NULL
    UNION ALL
    SELECT dv.id, dv.external_order_id, dv.status::text,
           'delivered', dv.delivered_lat, dv.delivered_lng, dv.delivered_at, r.name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.delivered_at >= v_from AND dv.delivered_at < v_to
      AND dv.delivered_lat IS NOT NULL AND dv.delivered_lng IS NOT NULL
    UNION ALL
    SELECT dv.id, dv.external_order_id, dv.status::text,
           'cancelled', dv.cancel_lat, dv.cancel_lng, dv.cancelled_at, r.name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.cancelled_at >= v_from AND dv.cancelled_at < v_to
      AND dv.cancel_lat IS NOT NULL AND dv.cancel_lng IS NOT NULL
  )
  SELECT jsonb_build_object(
    'driver_id', p_driver_id,
    'date', v_day,
    'from', v_from,
    'to', v_to,
    'points', COALESCE(
      (SELECT jsonb_agg(to_jsonb(kp) ORDER BY kp.idx) FROM kept_points kp), '[]'::jsonb
    ),
    'stops', COALESCE(
      (SELECT jsonb_agg(to_jsonb(rn) ORDER BY rn.arrived_at) FROM runs rn), '[]'::jsonb
    ),
    'deliveries', COALESCE(
      (SELECT jsonb_agg(to_jsonb(dd) ORDER BY dd.at) FROM dels dd), '[]'::jsonb
    ),
    -- One number per day, shared with the driver card. The sampled figure is a
    -- 75m-spaced polyline and reads low on a winding route, so it is not what the
    -- panel shows for today — but it is still returned, because it is the only
    -- distance that exists for a past day and the only one the drawn line supports.
    'distance_m', COALESCE(round(v_odometer, 2), round(dist.distance_m::numeric, 2)),
    'sampled_distance_m', round(dist.distance_m::numeric, 2),
    'distance_source', CASE WHEN v_odometer IS NULL THEN 'sampled' ELSE 'odometer' END,
    'duration_s', round(stats.duration_s::numeric, 0),
    'point_count', stats.total,
    'kept_count', (SELECT count(*) FROM kept_points)
  )
  INTO v_result
  FROM stats, dist;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.admin_get_driver_day_route(uuid, date, numeric) IS
  'Simplified GPS trail, stops and delivery markers for one driver on one Kuwait day. Coarse (>50m) fixes excluded; distance_m is the live odometer for today and the sampled sum for a past day.';

GRANT EXECUTE ON FUNCTION public.admin_get_driver_day_route(uuid, date, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One-time: re-seed today's odometer for drivers whose history proves contamination.
--
-- Today's values were accumulated under the old rules. That was survivable while only
-- the driver card read them; the route panel now reads the same field, so leaving them
-- would push a known-wrong number onto a second surface and make both surfaces agree on
-- a figure both know is wrong.
--
-- Scoped by *proof*, not by comparison. A full-resolution odometer is legitimately
-- **higher** than the 75m-sampled sum — sampling cuts corners off a winding route — so
-- "stored exceeds sampled" describes every honest rider and cannot be the test. The test
-- is whether today's history contains a fix worse than 50m: that driver's odometer
-- includes an unknown amount of tower-to-GPS hop, and the filtered sampled sum is the
-- only clean estimate left (raw fixes are not retained). It reads low, which is the
-- honest direction to be wrong in, and every fix from here accumulates at full
-- resolution again. Drivers with no coarse fix today are not touched.
-- ---------------------------------------------------------------------------
WITH today AS (
  SELECT
    dl.driver_id,
    ((now() AT TIME ZONE 'Asia/Kuwait')::date::timestamp AT TIME ZONE 'Asia/Kuwait') AS day_start
  FROM public.driver_locations dl
  WHERE (dl.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date
        = (now() AT TIME ZONE 'Asia/Kuwait')::date
    AND COALESCE(dl.distance_today_meters, 0) > 0
),
day_events AS (
  SELECT t.driver_id, e.recorded_at, e.accuracy_meters,
         e.latitude::double precision AS lat,
         e.longitude::double precision AS lng
  FROM today t
  JOIN public.driver_location_events e
    ON e.driver_id = t.driver_id
   AND e.recorded_at >= t.day_start
   AND e.recorded_at < t.day_start + interval '1 day'
),
contaminated AS (
  SELECT DISTINCT driver_id
  FROM day_events
  WHERE accuracy_meters > 50
),
segs AS (
  SELECT
    e.driver_id,
    public._haversine_meters(
      lag(e.lat) OVER (PARTITION BY e.driver_id ORDER BY e.recorded_at),
      lag(e.lng) OVER (PARTITION BY e.driver_id ORDER BY e.recorded_at),
      e.lat, e.lng
    ) AS seg_m,
    GREATEST(
      extract(epoch FROM (
        e.recorded_at - lag(e.recorded_at) OVER (PARTITION BY e.driver_id ORDER BY e.recorded_at)
      )),
      0.001
    ) AS gap_s
  FROM day_events e
  JOIN contaminated c ON c.driver_id = e.driver_id
  WHERE e.accuracy_meters IS NULL OR e.accuracy_meters <= 50
),
totals AS (
  SELECT driver_id,
         COALESCE(sum(CASE WHEN seg_m IS NULL OR seg_m / gap_s > 40 THEN 0 ELSE seg_m END), 0) AS distance_m
  FROM segs
  GROUP BY driver_id
)
UPDATE public.driver_locations dl
SET distance_today_meters = round(t.distance_m::numeric, 2)
FROM totals t
WHERE t.driver_id = dl.driver_id
  AND COALESCE(dl.distance_today_meters, 0) <> round(t.distance_m::numeric, 2);
