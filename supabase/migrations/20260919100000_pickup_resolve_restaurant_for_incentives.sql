-- Extra Earnings progress stays at 0 when a driver is assigned to more than
-- one restaurant. Pickup only snapshotted restaurant_id when the assignment
-- was unique; two published restaurants forced NULL. All active delivery_rules
-- today are restaurant-scoped, so delivery_matches_rules then rejects the
-- row and count_eligible_deliveries never increments. Single-restaurant
-- drivers were unaffected because the snapshot succeeded.
--
-- Resolve the restaurant from GPS (unique assignment, else the geofence/pin
-- the pickup is in, else the nearest assigned pin) and use that same id when
-- matching restaurant-scoped delivery and incentive rules.

CREATE OR REPLACE FUNCTION public.driver_resolve_pickup_restaurant(
  p_driver_id uuid,
  p_lat double precision,
  p_lng double precision
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_partner_id uuid;
  v_proximity integer;
  v_count integer;
  v_id uuid;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT partner_id INTO v_partner_id
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  SELECT COUNT(*)::integer, (array_agg(dr.restaurant_id))[1]
  INTO v_count, v_id
  FROM public.driver_restaurants dr
  INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
  WHERE dr.driver_id = p_driver_id
    AND r.status = 'published'
    AND r.is_active = true
    AND (
      v_partner_id IS NULL
      OR r.partner_id = v_partner_id
    );

  IF COALESCE(v_count, 0) = 1 THEN
    RETURN v_id;
  END IF;

  IF COALESCE(v_count, 0) = 0 OR p_lat IS NULL OR p_lng IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT dr.restaurant_id
  INTO v_id
  FROM public.driver_restaurants dr
  INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
  WHERE dr.driver_id = p_driver_id
    AND r.status = 'published'
    AND r.is_active = true
    AND (
      v_partner_id IS NULL
      OR r.partner_id = v_partner_id
    )
    AND public._driver_restaurant_delivery_allowed(
      p_driver_id,
      dr.restaurant_id,
      p_lat,
      p_lng,
      v_proximity
    )
  ORDER BY
    CASE
      WHEN r.latitude IS NOT NULL AND r.longitude IS NOT NULL THEN
        ST_Distance(
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography
        )
      ELSE NULL
    END NULLS LAST
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT dr.restaurant_id
  INTO v_id
  FROM public.driver_restaurants dr
  INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
  WHERE dr.driver_id = p_driver_id
    AND r.status = 'published'
    AND r.is_active = true
    AND (
      v_partner_id IS NULL
      OR r.partner_id = v_partner_id
    )
    AND r.latitude IS NOT NULL
    AND r.longitude IS NOT NULL
  ORDER BY ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography
  )
  LIMIT 1;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_scope_restaurant_id(
  p_restaurant_id uuid,
  p_driver_id uuid,
  p_lat double precision,
  p_lng double precision
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    p_restaurant_id,
    public.driver_resolve_pickup_restaurant(p_driver_id, p_lat, p_lng)
  );
$$;

REVOKE ALL ON FUNCTION public.driver_resolve_pickup_restaurant(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_resolve_pickup_restaurant(uuid, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_resolve_pickup_restaurant(uuid, double precision, double precision) TO service_role;

REVOKE ALL ON FUNCTION public.delivery_scope_restaurant_id(uuid, uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_scope_restaurant_id(uuid, uuid, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_scope_restaurant_id(uuid, uuid, double precision, double precision) TO service_role;

CREATE OR REPLACE FUNCTION public.delivery_matches_rules(
  p_delivery_id uuid,
  p_on_date date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery record;
  v_check_date date;
  v_rule_count int;
  v_match_count int;
  v_restaurant_id uuid;
BEGIN
  SELECT d.id, d.driver_id, d.zone_id, d.partner_id, d.restaurant_id,
         d.pickup_lat, d.pickup_lng, d.status,
         (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS deliver_date
  INTO v_delivery
  FROM public.deliveries d
  WHERE d.id = p_delivery_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_delivery.status IS DISTINCT FROM 'verified' THEN
    RETURN false;
  END IF;

  v_check_date := COALESCE(p_on_date, v_delivery.deliver_date);
  v_restaurant_id := public.delivery_scope_restaurant_id(
    v_delivery.restaurant_id,
    v_delivery.driver_id,
    v_delivery.pickup_lat::double precision,
    v_delivery.pickup_lng::double precision
  );

  SELECT count(*)::int INTO v_rule_count
  FROM public.delivery_rules dr
  WHERE dr.status = 'active'
    AND v_check_date BETWEEN dr.start_date AND dr.end_date;

  IF v_rule_count = 0 THEN
    RETURN true;
  END IF;

  SELECT count(*)::int INTO v_match_count
  FROM public.delivery_rules dr
  WHERE dr.status = 'active'
    AND v_check_date BETWEEN dr.start_date AND dr.end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s
      WHERE s.delivery_rule_id = dr.id
        AND (
          (dr.scope_type = 'zone' AND s.zone_id = v_delivery.zone_id)
          OR (dr.scope_type = 'partner' AND s.partner_id = v_delivery.partner_id)
          OR (dr.scope_type = 'restaurant' AND s.restaurant_id = v_restaurant_id)
        )
    );

  RETURN v_match_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_eligible_deliveries(
  p_driver_id uuid,
  p_earn_date date,
  p_incentive_rule_id uuid
)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_period_start date;
  v_period_end date;
  v_count int;
BEGIN
  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_incentive_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_period_end := p_earn_date;

  CASE v_rule.period
    WHEN 'daily' THEN
      v_period_start := p_earn_date;
    WHEN 'weekly' THEN
      v_period_start := public.kuwait_week_start(p_earn_date);
    WHEN 'monthly' THEN
      v_period_start := public.kuwait_month_start(p_earn_date);
  END CASE;

  SELECT count(*)::int INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN v_period_start AND v_period_end
    AND public.delivery_matches_rules(d.id, p_earn_date)
    AND EXISTS (
      SELECT 1
      FROM public.incentive_rule_scopes s
      WHERE s.incentive_rule_id = p_incentive_rule_id
        AND (
          (v_rule.scope_type = 'zone' AND s.zone_id = d.zone_id)
          OR (v_rule.scope_type = 'partner' AND s.partner_id = d.partner_id)
          OR (
            v_rule.scope_type = 'restaurant'
            AND s.restaurant_id = public.delivery_scope_restaurant_id(
              d.restaurant_id,
              d.driver_id,
              d.pickup_lat::double precision,
              d.pickup_lng::double precision
            )
          )
        )
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_count_eligible_deliveries_on_dates(
  p_driver_id uuid,
  p_incentive_rule_id uuid,
  p_dates date[]
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_count integer;
BEGIN
  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN 0;
  END IF;

  IF p_incentive_rule_id IS NULL THEN
    SELECT count(*)::integer INTO v_count
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
      AND public.delivery_matches_rules(
        d.id,
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
      );
    RETURN COALESCE(v_count, 0);
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_incentive_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
    AND public.delivery_matches_rules(
      d.id,
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
    )
    AND EXISTS (
      SELECT 1
      FROM public.incentive_rule_scopes s
      WHERE s.incentive_rule_id = p_incentive_rule_id
        AND (
          (v_rule.scope_type = 'zone' AND s.zone_id = d.zone_id)
          OR (v_rule.scope_type = 'partner' AND s.partner_id = d.partner_id)
          OR (
            v_rule.scope_type = 'restaurant'
            AND s.restaurant_id = public.delivery_scope_restaurant_id(
              d.restaurant_id,
              d.driver_id,
              d.pickup_lat::double precision,
              d.pickup_lng::double precision
            )
          )
        )
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

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
