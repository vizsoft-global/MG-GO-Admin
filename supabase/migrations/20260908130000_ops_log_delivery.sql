-- Emit driver_operation_events from the delivery RPCs. Signatures unchanged.
--
-- All three are Class B, so failures go through the autonomous emitter. These are
-- the highest-value failures in the whole system: every one of them means the
-- driver was stopped from completing work, which is exactly what support gets
-- called about. Volume is a handful per driver per day, so a loopback connection
-- each is affordable.
--
-- Not logged: not_authenticated, location_required, cancel_reason_required and
-- the on-duty/device guards. Those are client bugs or preconditions the app
-- already enforces, and they carry no information an admin would act on.
--
-- The idempotent early returns (completing an already-pending delivery,
-- cancelling an already-cancelled one) are also not logged - they are retries of
-- an operation already in the feed, and logging them would show work that never
-- happened twice.

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

  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NOT NULL AND v_norm <> '' THEN
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

CREATE OR REPLACE FUNCTION public.driver_complete_delivery(
  p_delivery_id uuid,
  p_delivery_proof_url text DEFAULT NULL::text,
  p_delivered_lat numeric DEFAULT NULL::numeric,
  p_delivered_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS deliveries
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
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

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
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'delivery_not_found',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    RETURN v_row;
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
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

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.complete', 'rpc', 'driver_complete_delivery',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'restaurant_id', v_row.restaurant_id
    ),
    p_delivered_lat, p_delivered_lng
  );

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_cancel_delivery(
  p_delivery_id uuid,
  p_cancel_reason text DEFAULT NULL::text,
  p_cancel_proof_url text DEFAULT NULL::text,
  p_cancel_lat numeric DEFAULT NULL::numeric,
  p_cancel_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS deliveries
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
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

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
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'delivery_not_found',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    RETURN v_row;
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
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

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.cancel', 'rpc', 'driver_cancel_delivery',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'cancel_reason', v_reason
    ),
    p_cancel_lat, p_cancel_lng
  );

  RETURN v_row;
END;
$function$;
