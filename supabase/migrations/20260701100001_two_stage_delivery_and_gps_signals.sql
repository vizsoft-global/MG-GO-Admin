-- Two-stage delivery (pickup -> deliver/cancel) + enriched GPS signals.

-- Pickup / cancel columns on deliveries.
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS pickup_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS pickup_proof_url text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS cancel_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_proof_url text;

ALTER TABLE public.deliveries
  ALTER COLUMN delivered_at DROP NOT NULL,
  ALTER COLUMN delivered_at DROP DEFAULT;

COMMENT ON COLUMN public.deliveries.pickup_at IS 'Timestamp when the driver confirmed pickup at the restaurant.';
COMMENT ON COLUMN public.deliveries.pickup_proof_url IS 'R2 object key for pickup proof photo.';
COMMENT ON COLUMN public.deliveries.cancel_reason IS 'Reason code or free-text when rider cancels after pickup.';

-- At most one in-transit delivery per driver.
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_one_in_transit_per_driver_idx
  ON public.deliveries (driver_id)
  WHERE status = 'in_transit'::public.delivery_status;

-- Enriched GPS signals on live + history tables.
ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS altitude_m numeric(8, 2),
  ADD COLUMN IF NOT EXISTS network_type text,
  ADD COLUMN IF NOT EXISTS charging_state text,
  ADD COLUMN IF NOT EXISTS is_mocked boolean,
  ADD COLUMN IF NOT EXISTS location_provider text,
  ADD COLUMN IF NOT EXISTS active_delivery_id uuid REFERENCES public.deliveries(id) ON DELETE SET NULL;

ALTER TABLE public.driver_location_events
  ADD COLUMN IF NOT EXISTS heading_deg numeric(6, 2),
  ADD COLUMN IF NOT EXISTS altitude_m numeric(8, 2),
  ADD COLUMN IF NOT EXISTS network_type text,
  ADD COLUMN IF NOT EXISTS charging_state text,
  ADD COLUMN IF NOT EXISTS is_mocked boolean,
  ADD COLUMN IF NOT EXISTS location_provider text,
  ADD COLUMN IF NOT EXISTS active_delivery_id uuid REFERENCES public.deliveries(id) ON DELETE SET NULL;

-- Feature flag for gradual rollout (default off; new app ignores and uses two-stage RPCs).
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS feature_two_stage_delivery boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.feature_two_stage_delivery IS
  'When true, driver app uses pickup -> deliver/cancel flow. Old single-stage clients use driver_create_delivery shim.';

-- Helper: ensure driver is active and on duty.
CREATE OR REPLACE FUNCTION public._driver_assert_active_on_duty(p_uid uuid)
RETURNS public.drivers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    RAISE EXCEPTION 'driver_off_duty' USING MESSAGE = 'You must be on duty';
  END IF;
  RETURN v_driver;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_active_pickup()
RETURNS public.deliveries
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status = 'in_transit'::public.delivery_status
  ORDER BY d.pickup_at DESC NULLS LAST, d.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL,
  p_order_proof_url text DEFAULT NULL,
  p_pickup_lat numeric DEFAULT NULL,
  p_pickup_lng numeric DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_norm text;
  v_order_id text;
  v_proximity integer;
  v_active uuid;
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
    RAISE EXCEPTION 'active_pickup_exists'
      USING MESSAGE = 'You already have an order in progress. Complete or cancel it first.';
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

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'location_required' USING MESSAGE = 'GPS location is required';
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
    RAISE EXCEPTION 'delivery_out_of_range'
      USING MESSAGE = 'You are outside the allowed delivery area';
  END IF;

  INSERT INTO public.deliveries (
    driver_id,
    partner_id,
    zone_id,
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
$$;

CREATE OR REPLACE FUNCTION public.driver_complete_delivery(
  p_delivery_id uuid,
  p_delivery_proof_url text DEFAULT NULL,
  p_delivered_lat numeric DEFAULT NULL,
  p_delivered_lng numeric DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RAISE EXCEPTION 'location_required' USING MESSAGE = 'GPS location is required';
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
    RAISE EXCEPTION 'invalid_delivery_status'
      USING MESSAGE = 'Delivery is not in progress';
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
$$;

CREATE OR REPLACE FUNCTION public.driver_cancel_delivery(
  p_delivery_id uuid,
  p_cancel_reason text DEFAULT NULL,
  p_cancel_proof_url text DEFAULT NULL,
  p_cancel_lat numeric DEFAULT NULL,
  p_cancel_lng numeric DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    RAISE EXCEPTION 'cancel_reason_required' USING MESSAGE = 'Cancel reason is required';
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    RAISE EXCEPTION 'location_required' USING MESSAGE = 'GPS location is required';
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
    RAISE EXCEPTION 'invalid_delivery_status'
      USING MESSAGE = 'Delivery is not in progress';
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
$$;

-- Deprecated shim: old single-stage clients still work for one release.
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
  v_pickup public.deliveries%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
BEGIN
  v_pickup := public.driver_create_pickup(
    p_external_order_id,
    NULL,
    p_delivered_lat,
    p_delivered_lng
  );

  v_row := public.driver_complete_delivery(
    v_pickup.id,
    p_order_proof_url,
    p_delivered_lat,
    p_delivered_lng
  );

  RETURN v_row;
END;
$$;

-- Extend driver_report_location with enriched signals.
CREATE OR REPLACE FUNCTION public.driver_report_location(
  p_latitude numeric,
  p_longitude numeric,
  p_speed_mps numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_battery_pct smallint DEFAULT NULL,
  p_tracking_status text DEFAULT 'idle',
  p_delivery_id uuid DEFAULT NULL,
  p_force_history boolean DEFAULT false,
  p_heading_deg numeric DEFAULT NULL,
  p_altitude_m numeric DEFAULT NULL,
  p_network_type text DEFAULT NULL,
  p_charging_state text DEFAULT NULL,
  p_is_mocked boolean DEFAULT NULL,
  p_location_provider text DEFAULT NULL,
  p_active_delivery_id uuid DEFAULT NULL
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
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_active_pickup() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_create_pickup(text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_complete_delivery(uuid, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_cancel_delivery(uuid, text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_create_delivery(text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_report_location(
  numeric, numeric, numeric, numeric, smallint, text, uuid, boolean,
  numeric, numeric, text, text, boolean, text, uuid
) TO authenticated;
