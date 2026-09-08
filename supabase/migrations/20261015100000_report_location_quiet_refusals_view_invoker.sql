-- driver_report_location: refuse quietly, and stop tripping FKs on stale delivery ids.
-- Plus: the three attendance views run as the caller, not as postgres.
--
-- Postgres logged ~130k ERROR rows in 24h (4 Sep). Almost all were this RPC:
--   107,563  P0001 driver_off_duty         — phones still posting after the server
--                                            clocked them out (old builds never stop)
--     9,883  P0001 delivery_id_required    — builds before 1.1.17 hold `delivery_submit`
--                                            for the whole trip without a delivery id
--    10,300  23503 FK violation            — active_delivery_id / delivery_id pointing
--                                            at a delivery that has since been deleted
--
-- Every one of those is a RAISE, which means a full exception unwind, a rolled-back
-- transaction and an ERROR log line — for a request whose answer was already known
-- before any work was done. None of them is a defect on the server; they are stale
-- phones, and stale phones cannot be fixed from here. What can be fixed is the cost.
--
--   1. Off duty is a refusal, not an exception. The RPC sets response.status = 409 and
--      returns the PostgREST-shaped error body ({code, message, details}). The contract
--      the app depends on is preserved byte-for-byte where it matters: a non-2xx status
--      and a body whose `message` contains `driver_off_duty` — which is exactly what
--      LocationTrackingHttpException.isOffDuty and the offline drain match on, so builds
--      >= 1.1.17 still stop the foreground service and drop the queued row. Old builds
--      retried a 400 forever; they will retry a 409 forever. Same phones, one less
--      rollback each. Nothing is written, so there is nothing to roll back.
--   2. `delivery_submit` without a delivery id is downgraded to the motion status the
--      speed implies (moving >= 1 m/s, else idle) instead of refused. That mirrors the
--      app-side rule shipped 2026-08-17 (`reportableStatus` refuses to claim
--      delivery_submit without an id) — a fix with a weaker label keeps the pin alive; a
--      rejected one loses the rider for the whole trip. A real submission always carries
--      the id, so the audit-point semantics of delivery_submit are untouched.
--   3. p_active_delivery_id / p_delivery_id are checked against deliveries before the
--      write and nulled when the row is gone. The FK is ON DELETE SET NULL, so a later
--      delete already produces exactly this state; the only difference is a phone that
--      has not yet noticed the delete no longer aborts its own heartbeat.
--
-- Everything else — early coalesce, odometer gate, upsert, geofence events, sampled
-- history — is byte-identical to 20261013100000.
--
-- Views. v_attendance_daily, v_attendance_exceptions and v_live_operations were plain
-- views owned by postgres, which in Postgres means they read their base tables with the
-- OWNER's privileges (the advisor calls this "SECURITY DEFINER view"). Both roles held
-- SELECT on them, so an authenticated rider could read the whole fleet's attendance,
-- shifts and GPS through the view — RLS on the base tables never ran. Proven before
-- applying: with security_invoker = true, a staff session reads the identical row counts
-- (704 / 173 / 922 over the last 3 days) and a rider session reads 1 / 0 / 0 (their own
-- row). Admin reads them through server actions under a staff session, and the
-- performance RPCs are SECURITY DEFINER themselves, so neither path changes. anon is
-- revoked outright — nothing unauthenticated has any business on an attendance view.

ALTER VIEW public.v_attendance_daily SET (security_invoker = true);
ALTER VIEW public.v_attendance_exceptions SET (security_invoker = true);
ALTER VIEW public.v_live_operations SET (security_invoker = true);

REVOKE ALL ON public.v_attendance_daily FROM anon;
REVOKE ALL ON public.v_attendance_exceptions FROM anon;
REVOKE ALL ON public.v_live_operations FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_attendance_daily FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_attendance_exceptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_live_operations FROM authenticated;

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
  v_min_interval integer;
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
  v_delivery_id uuid := p_delivery_id;
  v_active_delivery_id uuid := p_active_delivery_id;
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

  -- Refusal, not exception: same non-2xx + `message` contract the app matches on,
  -- without the unwind, the rollback or the ERROR log line. See header.
  IF NOT v_driver.is_on_duty THEN
    PERFORM set_config('response.status', '409', true);
    RETURN jsonb_build_object(
      'code', 'driver_off_duty',
      'message', 'driver_off_duty',
      'details', 'Location tracking requires on-duty status',
      'hint', NULL
    );
  END IF;

  -- Old builds hold delivery_submit for the whole trip with no id. Downgrade to the
  -- motion status rather than refuse; a real submission always carries the id.
  IF v_status = 'delivery_submit' AND v_delivery_id IS NULL THEN
    v_status := CASE WHEN COALESCE(p_speed_mps, 0) >= 1 THEN 'moving' ELSE 'idle' END;
  END IF;

  -- A phone can outlive the delivery it is pointing at. The FK is ON DELETE SET NULL,
  -- so this only anticipates the state a delete would have produced anyway.
  IF v_active_delivery_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE id = v_active_delivery_id) THEN
    v_active_delivery_id := NULL;
  END IF;
  IF v_delivery_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.deliveries WHERE id = v_delivery_id) THEN
    v_delivery_id := NULL;
  END IF;

  SELECT * INTO v_prev FROM public.driver_locations WHERE driver_id = v_uid;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500),
         COALESCE(driver_location_rpc_min_interval_seconds, 15)
  INTO v_proximity, v_min_interval
  FROM public.app_settings
  WHERE id = 1;

  v_proximity := COALESCE(v_proximity, 500);
  v_min_interval := COALESCE(v_min_interval, 15);

  -- Early coalesce. Runs before any geofence work and ignores p_force_history:
  -- a same-status fix that has not moved 18m inside the interval carries no new
  -- information, whatever the caller thinks. delivery_submit is exempt.
  IF v_prev.driver_id IS NOT NULL
     AND v_min_interval > 0
     AND v_status <> 'delivery_submit'
  THEN
    v_secs_since_live := extract(epoch FROM (v_now - v_prev.last_seen_at));
    v_dist_live := public._haversine_meters(
      v_prev.latitude::double precision,
      v_prev.longitude::double precision,
      p_latitude::double precision,
      p_longitude::double precision
    );
    IF v_secs_since_live < v_min_interval
       AND v_dist_live < 18
       AND v_prev.tracking_status IS NOT DISTINCT FROM v_status
    THEN
      -- Liveness heartbeat, throttled to 60s so the coalesced path stays a
      -- near-zero-cost read for the storm case.
      IF COALESCE(v_prev.last_report_at, v_prev.last_seen_at) < v_now - interval '60 seconds' THEN
        UPDATE public.driver_locations
        SET last_report_at = v_now,
            coalesced_since_count = COALESCE(coalesced_since_count, 0) + 1
        WHERE driver_id = v_uid;
      END IF;

      RETURN jsonb_build_object(
        'zone_status', coalesce(v_prev.zone_status, 'unknown'),
        'in_range', coalesce(v_prev.zone_status, 'unknown') IS DISTINCT FROM 'out_of_zone',
        'last_seen_at', v_prev.last_seen_at,
        'history_written', false,
        'tracking_status', v_prev.tracking_status,
        'speed_mps', v_prev.speed_mps,
        'distance_today_meters', coalesce(v_prev.distance_today_meters, 0),
        'coalesced', true
      );
    END IF;
  END IF;

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
      v_secs_since_live := extract(epoch FROM (v_now - v_prev.last_seen_at));

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
    v_active_delivery_id,
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
      v_active_delivery_id,
      v_status,
      v_zone_status,
      v_delivery_id,
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
  'Driver live position + sampled history. Same-status fixes < 18m inside app_settings.driver_location_rpc_min_interval_seconds are coalesced before any geofence work, regardless of p_force_history; delivery_submit always writes. Off duty returns HTTP 409 {code: driver_off_duty} instead of raising; delivery_submit without an id downgrades to moving/idle; stale delivery ids are nulled before the write.';
