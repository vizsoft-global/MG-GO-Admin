-- Pickup / delivered / cancel proofs were one object key each. Riders need
-- several stills per action. Keep the scalar columns as the first key so
-- older app builds and list queries still work. The text RPC params accept
-- either a single key or a JSON array of keys (max 5).

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS pickup_proof_urls text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS order_proof_urls text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS cancel_proof_urls text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.deliveries
SET pickup_proof_urls = ARRAY[pickup_proof_url]
WHERE pickup_proof_url IS NOT NULL
  AND btrim(pickup_proof_url) <> ''
  AND cardinality(pickup_proof_urls) = 0;

UPDATE public.deliveries
SET order_proof_urls = ARRAY[order_proof_url]
WHERE order_proof_url IS NOT NULL
  AND btrim(order_proof_url) <> ''
  AND cardinality(order_proof_urls) = 0;

UPDATE public.deliveries
SET cancel_proof_urls = ARRAY[cancel_proof_url]
WHERE cancel_proof_url IS NOT NULL
  AND btrim(cancel_proof_url) <> ''
  AND cardinality(cancel_proof_urls) = 0;

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_pickup_proof_urls_max;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_pickup_proof_urls_max
  CHECK (cardinality(pickup_proof_urls) <= 5);

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_order_proof_urls_max;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_order_proof_urls_max
  CHECK (cardinality(order_proof_urls) <= 5);

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_cancel_proof_urls_max;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_cancel_proof_urls_max
  CHECK (cardinality(cancel_proof_urls) <= 5);

CREATE OR REPLACE FUNCTION public._delivery_parse_proof_keys(p_raw text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_trimmed text := NULLIF(btrim(COALESCE(p_raw, '')), '');
  v_json jsonb;
  v_elem text;
  v_out text[] := '{}'::text[];
BEGIN
  IF v_trimmed IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  IF left(v_trimmed, 1) = '[' THEN
    BEGIN
      v_json := v_trimmed::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_proof_keys';
    END;
    IF jsonb_typeof(v_json) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_proof_keys';
    END IF;
    FOR v_elem IN SELECT jsonb_array_elements_text(v_json)
    LOOP
      v_elem := NULLIF(btrim(v_elem), '');
      IF v_elem IS NULL THEN
        CONTINUE;
      END IF;
      IF v_elem ~ '\.\.' OR char_length(v_elem) > 512 THEN
        RAISE EXCEPTION 'invalid_proof_keys';
      END IF;
      IF NOT v_elem = ANY (v_out) THEN
        v_out := v_out || v_elem;
      END IF;
    END LOOP;
  ELSE
    IF v_trimmed ~ '\.\.' OR char_length(v_trimmed) > 512 THEN
      RAISE EXCEPTION 'invalid_proof_keys';
    END IF;
    v_out := ARRAY[v_trimmed];
  END IF;

  IF cardinality(v_out) > 5 THEN
    RAISE EXCEPTION 'too_many_proofs';
  END IF;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public._delivery_parse_proof_keys(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL::text,
  p_order_proof_url text DEFAULT NULL::text,
  p_pickup_lat numeric DEFAULT NULL::numeric,
  p_pickup_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
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
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_dup boolean;
  v_proof_keys text[];
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

  BEGIN
    v_order_id := public.assert_external_order_id(p_external_order_id);
  EXCEPTION WHEN others THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      SQLERRM,
      jsonb_build_object('order_id_tried', p_external_order_id)
    );
  END;

  v_norm := public.normalize_external_order_id(v_order_id);

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'location_required',
      jsonb_build_object('order_id_tried', p_external_order_id)
    );
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

  v_restaurant_id := public.driver_resolve_pickup_restaurant(
    v_uid,
    p_pickup_lat::double precision,
    p_pickup_lng::double precision
  );

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
    v_proof_keys := public._delivery_parse_proof_keys(p_order_proof_url);
  EXCEPTION WHEN others THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      SQLERRM,
      jsonb_build_object('order_id_tried', p_external_order_id)
    );
  END;

  BEGIN
    INSERT INTO public.deliveries (
      driver_id,
      partner_id,
      zone_id,
      restaurant_id,
      external_order_id,
      pickup_proof_url,
      pickup_proof_urls,
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
      v_proof_keys[1],
      v_proof_keys,
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
      'partner_id', v_row.partner_id,
      'proof_count', cardinality(v_proof_keys)
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
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
  v_proof_keys text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'delivery_id_required', '{}'::jsonb
    );
  END IF;

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'location_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
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

  BEGIN
    v_proof_keys := public._delivery_parse_proof_keys(p_delivery_proof_url);
  EXCEPTION WHEN others THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      SQLERRM,
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END;

  UPDATE public.deliveries
  SET order_proof_url = v_proof_keys[1],
      order_proof_urls = v_proof_keys,
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
      'restaurant_id', v_row.restaurant_id,
      'proof_count', cardinality(v_proof_keys)
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
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
  v_reason text;
  v_proof_keys text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'delivery_id_required', '{}'::jsonb
    );
  END IF;

  v_reason := NULLIF(trim(p_cancel_reason), '');
  IF v_reason IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'cancel_reason_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'location_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
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

  BEGIN
    v_proof_keys := public._delivery_parse_proof_keys(p_cancel_proof_url);
  EXCEPTION WHEN others THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      SQLERRM,
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END;

  UPDATE public.deliveries
  SET cancel_reason = v_reason,
      cancel_proof_url = v_proof_keys[1],
      cancel_proof_urls = v_proof_keys,
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
      'cancel_reason', v_reason,
      'proof_count', cardinality(v_proof_keys)
    ),
    p_cancel_lat, p_cancel_lng
  );

  RETURN v_row;
END;
$function$;

COMMENT ON COLUMN public.deliveries.pickup_proof_urls IS
  'R2 object keys for pickup stills. pickup_proof_url is always the first key.';
COMMENT ON COLUMN public.deliveries.order_proof_urls IS
  'R2 object keys for delivered stills. order_proof_url is always the first key.';
COMMENT ON COLUMN public.deliveries.cancel_proof_urls IS
  'R2 object keys for cancel stills. cancel_proof_url is always the first key.';
