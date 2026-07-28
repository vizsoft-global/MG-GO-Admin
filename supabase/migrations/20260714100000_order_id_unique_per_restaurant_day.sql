-- Order ID uniqueness: change from "globally unique forever" to
-- "unique only within (restaurant_id, business day)".
--
-- Background
-- ----------
-- Previously, `driver_create_pickup` invoked `driver_check_order_id_available`
-- which rejected any external_order_id that already existed anywhere in the
-- `deliveries` table at any time. That blocked legitimate re-use of the same
-- printed receipt / POS number across different restaurants or different days
-- (a real workflow: many restaurants restart their order numbering daily).
--
-- New rule (confirmed by ops 2026-05-27):
--   * Order IDs CAN repeat across different restaurants.
--   * Order IDs CAN repeat across different days for the same restaurant.
--   * Within (same restaurant, same business day [Asia/Kuwait]), an order
--     id must NOT repeat.
--
-- Implementation
-- --------------
-- The check is inlined inside `driver_create_pickup` (replacing the call to
-- `driver_check_order_id_available`) so that it runs *after* the
-- restaurant_id has been resolved from `driver_restaurants` — the duplicate
-- scope depends on which restaurant the pickup will be attached to.
--
-- Skipped cases (always allowed):
--   * The pickup has no resolved restaurant_id (no scope to check against).
--   * The driver did not provide an order id.
--
-- Excluded from the dup check:
--   * Cancelled deliveries — a driver may re-enter the same id after
--     cancelling a previous attempt for the same restaurant/day.
--
-- Business-day boundary: Asia/Kuwait, consistent with shift adherence,
-- incentive accruals, and duty-day calculations elsewhere in this schema.

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
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_dup boolean;
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

  -- Per-(restaurant, business day) order_id uniqueness check.
  -- Skips when no restaurant scope or no order id; ignores cancelled rows.
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
      RAISE EXCEPTION 'duplicate_order_id';
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
