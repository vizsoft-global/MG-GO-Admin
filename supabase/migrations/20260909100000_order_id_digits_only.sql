-- Reject non-digit / oversized partner Order IDs on write.
-- Existing junk rows stay; UPDATE of other columns is unaffected
-- (trigger is INSERT OR UPDATE OF external_order_id only).

CREATE OR REPLACE FUNCTION public.assert_external_order_id(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_id text;
BEGIN
  v_id := trim(both '#' from trim(coalesce(p_raw, '')));
  IF v_id = '' THEN
    RETURN NULL;
  END IF;
  IF v_id !~ '^[0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_order_id';
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deliveries_guard_external_order_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.external_order_id := public.assert_external_order_id(NEW.external_order_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deliveries_guard_external_order_id ON public.deliveries;
CREATE TRIGGER deliveries_guard_external_order_id
  BEFORE INSERT OR UPDATE OF external_order_id
  ON public.deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.deliveries_guard_external_order_id();

CREATE OR REPLACE FUNCTION public.driver_check_order_id_available(p_external_order_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_id := public.assert_external_order_id(p_external_order_id);
  IF v_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE public.normalize_external_order_id(d.external_order_id) = v_id
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

-- Validate before proximity so a bad Order ID fails immediately.
CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL::text,
  p_order_proof_url text DEFAULT NULL::text,
  p_pickup_lat numeric DEFAULT NULL::numeric,
  p_pickup_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS deliveries
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
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_dup boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_driver := public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  SELECT d.id INTO v_active
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status = 'in_transit'::public.delivery_status
  LIMIT 1;

  IF v_active IS NOT NULL THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'active_pickup_exists',
      jsonb_build_object('blocking_delivery_id', v_active, 'order_id_tried', p_external_order_id)
    );
    RAISE EXCEPTION 'active_pickup_exists';
  END IF;

  v_order_id := public.assert_external_order_id(p_external_order_id);
  v_norm := public.normalize_external_order_id(v_order_id);

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
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'delivery_out_of_range',
      jsonb_build_object(
        'order_id_tried', p_external_order_id,
        'proximity_meters', v_proximity,
        'lat', p_pickup_lat,
        'lng', p_pickup_lng
      )
    );
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

  IF v_norm IS NOT NULL
     AND v_norm <> ''
     AND v_restaurant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.deliveries d
      WHERE d.restaurant_id = v_restaurant_id
        AND d.status <> 'cancelled'::public.delivery_status
        AND public.normalize_external_order_id(d.external_order_id) = v_norm
        AND (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date = v_today
    ) INTO v_dup;

    IF v_dup THEN
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
        'duplicate_order_id',
        jsonb_build_object('order_id_tried', v_order_id, 'restaurant_id', v_restaurant_id)
      );
      RAISE EXCEPTION 'duplicate_order_id';
    END IF;
  END IF;

  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
        'duplicate_order_id',
        jsonb_build_object('order_id_tried', v_order_id, 'source', 'unique_index')
      );
      RAISE EXCEPTION 'duplicate_order_id';
  END;

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.pickup_create', 'rpc', 'driver_create_pickup',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'restaurant_id', v_row.restaurant_id,
      'partner_id', v_row.partner_id
    ),
    p_pickup_lat, p_pickup_lng
  );

  RETURN v_row;
END;
$function$;
