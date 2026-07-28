-- Zone-assigned drivers: proximity to zone only.
-- No zone: proximity to assigned restaurants only.
-- Order ID optional on driver_create_delivery.

CREATE OR REPLACE FUNCTION public.driver_check_order_id_available(p_external_order_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NULL OR v_norm = '' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE public.normalize_external_order_id(d.external_order_id) = v_norm
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_is_within_delivery_range(
  p_driver_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_proximity_meters integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_proximity integer;
  v_driver public.drivers%ROWTYPE;
  v_zone public.zones%ROWTYPE;
  v_point extensions.geography;
  v_near_restaurant boolean := false;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN false;
  END IF;

  v_proximity := COALESCE(
    p_proximity_meters,
    (SELECT driver_app_delivery_proximity_meters FROM public.app_settings WHERE id = 1),
    500
  );

  IF v_proximity <= 0 THEN
    RETURN true;
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_driver.zone_id IS NOT NULL THEN
    SELECT * INTO v_zone FROM public.zones WHERE id = v_driver.zone_id;
    IF FOUND AND v_zone.geometry IS NOT NULL THEN
      RETURN public._point_within_zone_proximity(
        p_lat,
        p_lng,
        v_zone.geometry,
        v_zone.zone_type,
        v_proximity
      );
    END IF;
    RETURN false;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;

  SELECT EXISTS (
    SELECT 1
    FROM public.driver_restaurants dr
    JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = p_driver_id
      AND r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND ST_DWithin(
        v_point,
        ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::extensions.geography,
        v_proximity
      )
  ) INTO v_near_restaurant;

  RETURN v_near_restaurant;
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

GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_create_delivery(text, text, numeric, numeric) TO authenticated;
