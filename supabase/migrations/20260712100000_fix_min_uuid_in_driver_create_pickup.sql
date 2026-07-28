-- Fix: "function min(uuid) does not exist" when a driver with a partner_id
-- taps Pickup.
--
-- `driver_create_pickup` includes a branch that auto-attaches a restaurant
-- to the new delivery when the driver is mapped to exactly one published,
-- active restaurant for their partner. The original implementation used:
--
--     SELECT COUNT(*)::integer, MIN(dr.restaurant_id)
--     INTO v_matched_count, v_restaurant_id
--     FROM public.driver_restaurants dr ...
--
-- Postgres does not define `min()` as an aggregate over the `uuid` type
-- (uuid has comparison operators but no MIN/MAX aggregates by default),
-- so this branch always raised `function min(uuid) does not exist`
-- whenever the driver had `partner_id` set. The bug had been dormant for
-- drivers without a partner; once partner assignment rolled out, every
-- pickup attempt for those drivers failed with this error.
--
-- Fix: replace `MIN(dr.restaurant_id)` with `(array_agg(...))[1]`.
-- `array_agg` is defined for uuid, and because we only consume the value
-- when `v_matched_count = 1`, the array always contains exactly one row
-- at that point — so picking the first element is equivalent to the
-- original intent (and deterministic for the single-match case).

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
    SELECT
      COUNT(*)::integer,
      (array_agg(dr.restaurant_id))[1]
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
