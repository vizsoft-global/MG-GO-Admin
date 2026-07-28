-- Flexible partner/zone on restaurants and driver intakes; gate driver activation on published restaurants.

-- Restaurants: optional partner
ALTER TABLE public.restaurants
  ALTER COLUMN partner_id DROP NOT NULL;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_partner_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_partner_name_unique_idx
  ON public.restaurants (partner_id, name)
  WHERE partner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_standalone_name_unique_idx
  ON public.restaurants (name)
  WHERE partner_id IS NULL;

-- Prefer SET NULL when partner deleted (restaurant survives)
ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_partner_id_fkey;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;

-- Driver intakes: optional partner + zone
ALTER TABLE public.driver_intakes
  ALTER COLUMN partner_id DROP NOT NULL;

ALTER TABLE public.driver_intakes
  ALTER COLUMN zone_id DROP NOT NULL;

-- Helper: driver has at least one published, active restaurant mapped
CREATE OR REPLACE FUNCTION public.driver_has_active_restaurant(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_restaurants dr
    JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = p_driver_id
      AND r.is_active = true
  );
$$;

-- Block activation without published restaurant mapping
CREATE OR REPLACE FUNCTION public.enforce_driver_active_restaurant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active'::public.driver_status
     AND (OLD.status IS DISTINCT FROM NEW.status OR TG_OP = 'INSERT')
     AND NOT public.driver_has_active_restaurant(NEW.id) THEN
    RAISE EXCEPTION 'driver_missing_active_restaurant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_require_active_restaurant ON public.drivers;
CREATE TRIGGER drivers_require_active_restaurant
  BEFORE INSERT OR UPDATE OF status ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_driver_active_restaurant();

-- Downgrade active drivers when last published restaurant is removed
CREATE OR REPLACE FUNCTION public.sync_driver_status_after_restaurant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  v_driver_id := COALESCE(NEW.driver_id, OLD.driver_id);

  IF v_driver_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_driver_id
      AND d.status = 'active'::public.driver_status
      AND NOT public.driver_has_active_restaurant(v_driver_id)
  ) THEN
    UPDATE public.drivers
    SET status = 'pending'::public.driver_status, updated_at = now()
    WHERE id = v_driver_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS driver_restaurants_sync_status ON public.driver_restaurants;
CREATE TRIGGER driver_restaurants_sync_status
  AFTER INSERT OR UPDATE OR DELETE ON public.driver_restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_status_after_restaurant_change();

-- Admin RPC to set account status with same guardrails
CREATE OR REPLACE FUNCTION public.set_driver_account_status(
  p_driver_id uuid,
  p_status public.driver_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_status = 'active'::public.driver_status
     AND NOT public.driver_has_active_restaurant(p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_active_restaurant');
  END IF;

  UPDATE public.drivers
  SET status = p_status, updated_at = now()
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_has_active_restaurant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_account_status(uuid, public.driver_status) TO authenticated;

REVOKE ALL ON FUNCTION public.driver_has_active_restaurant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_driver_account_status(uuid, public.driver_status) FROM PUBLIC;
