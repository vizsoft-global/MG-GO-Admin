-- Driver app: delivery GPS, global order ID uniqueness, RLS, and RPCs.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS delivered_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS delivered_lng numeric(10, 7);

COMMENT ON COLUMN public.deliveries.delivered_lat IS
  'GPS latitude when the driver submitted the delivery.';
COMMENT ON COLUMN public.deliveries.delivered_lng IS
  'GPS longitude when the driver submitted the delivery.';

-- Global uniqueness for partner order numbers (normalized).
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_external_order_id_unique_idx
  ON public.deliveries (lower(trim(external_order_id)))
  WHERE external_order_id IS NOT NULL
    AND trim(external_order_id) <> '';

-- Driver policies (staff staff_all_deliveries remains for admin).
DROP POLICY IF EXISTS driver_select_own_deliveries ON public.deliveries;
CREATE POLICY driver_select_own_deliveries ON public.deliveries
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_insert_own_deliveries ON public.deliveries;
CREATE POLICY driver_insert_own_deliveries ON public.deliveries
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

-- Normalize order id for checks (strip #, trim, lower).
CREATE OR REPLACE FUNCTION public.normalize_external_order_id(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(both '#' from trim(coalesce(p_raw, ''))));
$$;

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
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE public.normalize_external_order_id(d.external_order_id) = v_norm
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_create_delivery(
  p_external_order_id text,
  p_order_proof_url text DEFAULT NULL,
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
  v_norm text;
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NULL OR v_norm = '' THEN
    RAISE EXCEPTION 'invalid_order_id' USING MESSAGE = 'Order ID is required';
  END IF;

  IF NOT public.driver_check_order_id_available(p_external_order_id) THEN
    RAISE EXCEPTION 'duplicate_order_id' USING MESSAGE = 'This order ID is already logged';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_driver.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'driver_not_active';
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
    trim(both '#' from trim(p_external_order_id)),
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

GRANT EXECUTE ON FUNCTION public.normalize_external_order_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_create_delivery(text, text, numeric, numeric) TO authenticated;
