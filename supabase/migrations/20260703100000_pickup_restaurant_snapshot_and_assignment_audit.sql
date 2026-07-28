-- Snapshot restaurant_id at pickup when unambiguous; audit driver assignment changes.

CREATE TABLE IF NOT EXISTS public.driver_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_type text NOT NULL,
  zone_id_before uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  zone_id_after uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  restaurant_ids_before uuid[] NOT NULL DEFAULT '{}',
  restaurant_ids_after uuid[] NOT NULL DEFAULT '{}',
  context_entity_type text,
  context_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_assignment_events_driver_id_idx
  ON public.driver_assignment_events (driver_id, created_at DESC);

ALTER TABLE public.driver_assignment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_assignment_events_admin_read ON public.driver_assignment_events;
CREATE POLICY driver_assignment_events_admin_read ON public.driver_assignment_events
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_assignment_events_admin_insert ON public.driver_assignment_events;
CREATE POLICY driver_assignment_events_admin_insert ON public.driver_assignment_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_panel_user());

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
$$;
