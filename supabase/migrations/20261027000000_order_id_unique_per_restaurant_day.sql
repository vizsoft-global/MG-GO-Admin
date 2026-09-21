-- Finish the 2026-05-27 rule that 20260714100000 put only in driver_create_pickup:
-- Order IDs are unique per (restaurant_id, Asia/Kuwait calendar day), not forever
-- and not fleet-wide. Same ID at a different store is allowed. Same store on a
-- later Kuwait day is allowed. Cancelled rows are ignored.
--
-- The leftover lifetime unique (deliveries_external_order_id_unique_idx) was
-- still raising ~98% of duplicate_order_id failures (35k / 14d). Drop it.
--
-- driver_check_order_id_available was still EXISTS-anywhere. Align it with
-- pickup. Extra GPS args are optional so one-arg app calls keep working.
-- Restaurant unknown (no unique assignment, no GPS) → true; pickup RPC is
-- the remaining same-store gate.
--
-- No replacement unique on (restaurant, order_id, kuwait_date): AT TIME ZONE
-- is not IMMUTABLE. Concurrent same-store-same-day inserts have a rare race
-- (EXISTS then INSERT, no DB constraint). Revisit a trigger-maintained date
-- column only if that race appears.

DROP INDEX IF EXISTS public.deliveries_external_order_id_unique_idx;

DROP FUNCTION IF EXISTS public.driver_check_order_id_available(text);
DROP FUNCTION IF EXISTS public.driver_check_order_id_available(text, numeric, numeric);

CREATE FUNCTION public.driver_check_order_id_available(
  p_external_order_id text,
  p_pickup_lat numeric DEFAULT NULL,
  p_pickup_lng numeric DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id text;
  v_restaurant_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_exists boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_id := public.assert_external_order_id(p_external_order_id);
  IF v_id IS NULL THEN
    RETURN true;
  END IF;

  v_restaurant_id := public.driver_resolve_pickup_restaurant(
    v_uid,
    p_pickup_lat::double precision,
    p_pickup_lng::double precision
  );

  IF v_restaurant_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.restaurant_id = v_restaurant_id
      AND d.status <> 'cancelled'::public.delivery_status
      AND public.normalize_external_order_id(d.external_order_id) = v_id
      AND (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date = v_today
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_check_order_id_available(text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text, numeric, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text, numeric, numeric) TO service_role;
