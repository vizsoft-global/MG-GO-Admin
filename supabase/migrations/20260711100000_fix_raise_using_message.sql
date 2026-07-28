-- Fix "RAISE option already specified: MESSAGE" errors that fire whenever a
-- driver-facing RPC tries to surface a friendly error to the app.
--
-- The pattern `RAISE EXCEPTION 'code' USING MESSAGE = 'text';` is rejected by
-- the stricter PL/pgSQL parser loaded via `supautils` for the `authenticated`
-- role (the parser treats `'code'` as the format string AND `USING MESSAGE`
-- as a second message, so it errors out before our actual condition can
-- propagate). The driver app then sees the cryptic Postgres error instead of
-- the real reason (e.g. driver_off_duty, shift_required), and the UI silently
-- bails on "Add Delivery" / "Go on duty" buttons because the catch handler
-- can't match the expected code.
--
-- Fix: drop the duplicate `USING MESSAGE` clause everywhere we already raise a
-- machine-readable code. The Flutter client matches on the code substring and
-- renders a localized message, so no UX is lost. Where we want extra context
-- for non-app callers, we move it into `DETAIL` (which has no duplicate
-- conflict with the format string).

CREATE OR REPLACE FUNCTION public._driver_assert_active_on_duty(p_uid uuid)
RETURNS public.drivers
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;
  IF v_driver.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'driver_not_active';
  END IF;
  IF NOT v_driver.is_on_duty THEN
    RAISE EXCEPTION 'driver_off_duty';
  END IF;
  RETURN v_driver;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_set_duty_state(p_is_on_duty boolean, p_is_online boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL::text,
  p_order_proof_url text DEFAULT NULL::text,
  p_pickup_lat numeric DEFAULT NULL::numeric,
  p_pickup_lng numeric DEFAULT NULL::numeric
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_norm text;
  v_order_id text;
  v_proximity integer;
  v_active uuid;
  v_restaurant_id uuid;
  v_matched_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_driver := public._driver_assert_active_on_duty(v_uid);

  SELECT d.id INTO v_active
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status = 'in_transit'::public.delivery_status
  LIMIT 1;

  IF v_active IS NOT NULL THEN
    RAISE EXCEPTION 'active_pickup_exists';
  END IF;

  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NOT NULL AND v_norm <> '' THEN
    IF NOT public.driver_check_order_id_available(p_external_order_id) THEN
      RAISE EXCEPTION 'duplicate_order_id';
    END IF;
    v_order_id := trim(both '#' from trim(p_external_order_id));
  ELSE
    v_order_id := NULL;
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity > 0
     AND NOT public.driver_is_within_delivery_range(
       v_uid,
       p_pickup_lat::double precision,
       p_pickup_lng::double precision,
       v_proximity
     ) THEN
    RAISE EXCEPTION 'delivery_out_of_range';
  END IF;

  v_restaurant_id := NULL;

  IF v_driver.partner_id IS NOT NULL THEN
    SELECT COUNT(*)::integer, MIN(dr.restaurant_id)
    INTO v_matched_count, v_restaurant_id
    FROM public.driver_restaurants dr
    INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = v_uid
      AND r.partner_id = v_driver.partner_id
      AND r.status = 'published'
      AND r.is_active = true;

    IF v_matched_count IS DISTINCT FROM 1 THEN
      v_restaurant_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.deliveries (
    driver_id,
    partner_id,
    zone_id,
    restaurant_id,
    external_order_id,
    pickup_proof_url,
    status,
    pickup_at,
    pickup_lat,
    pickup_lng
  ) VALUES (
    v_uid,
    v_driver.partner_id,
    v_driver.zone_id,
    v_restaurant_id,
    v_order_id,
    NULLIF(trim(p_order_proof_url), ''),
    'in_transit'::public.delivery_status,
    now(),
    p_pickup_lat,
    p_pickup_lng
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_complete_delivery(
  p_delivery_id uuid,
  p_delivery_proof_url text DEFAULT NULL::text,
  p_delivered_lat numeric DEFAULT NULL::numeric,
  p_delivered_lng numeric DEFAULT NULL::numeric
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET order_proof_url = NULLIF(trim(p_delivery_proof_url), ''),
      delivered_at = now(),
      delivered_lat = p_delivered_lat,
      delivered_lng = p_delivered_lng,
      status = 'pending'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_cancel_delivery(
  p_delivery_id uuid,
  p_cancel_reason text DEFAULT NULL::text,
  p_cancel_proof_url text DEFAULT NULL::text,
  p_cancel_lat numeric DEFAULT NULL::numeric,
  p_cancel_lng numeric DEFAULT NULL::numeric
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  v_reason := NULLIF(trim(p_cancel_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'cancel_reason_required';
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET cancel_reason = v_reason,
      cancel_proof_url = NULLIF(trim(p_cancel_proof_url), ''),
      cancelled_at = now(),
      cancel_lat = p_cancel_lat,
      cancel_lng = p_cancel_lng,
      status = 'cancelled'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- The driver app only calls the 15-arg overload (with extras); patch the
-- `driver_off_duty` RAISE there so background location reporting also surfaces
-- the correct error code.
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
    RAISE EXCEPTION 'driver_off_duty';
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
    heading_deg,
    altitude_m,
    network_type,
    charging_state,
    is_mocked,
    location_provider,
    active_delivery_id,
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
    p_heading_deg,
    p_altitude_m,
    NULLIF(trim(p_network_type), ''),
    NULLIF(trim(p_charging_state), ''),
    p_is_mocked,
    NULLIF(trim(p_location_provider), ''),
    p_active_delivery_id,
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
    heading_deg = EXCLUDED.heading_deg,
    altitude_m = EXCLUDED.altitude_m,
    network_type = EXCLUDED.network_type,
    charging_state = EXCLUDED.charging_state,
    is_mocked = EXCLUDED.is_mocked,
    location_provider = EXCLUDED.location_provider,
    active_delivery_id = EXCLUDED.active_delivery_id,
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
    'tracking_status', v_status
  );
END;
$function$;

-- Drop the stale 8-arg overload so PostgREST can resolve the RPC unambiguously
-- and there is no second code path that could re-introduce the bug later.
DROP FUNCTION IF EXISTS public.driver_report_location(
  numeric, numeric, numeric, numeric, smallint, text, uuid, boolean
);
