-- Restaurants: a restaurant cannot be `published` (active) without either
-- valid GPS coordinates OR at least one inclusion geofence. If the row is
-- saved with status = 'published' but no location proof, demote it to
-- 'draft' (and is_active = false) so the published list always represents
-- routable, deliverable restaurants.

CREATE OR REPLACE FUNCTION public.restaurant_enforce_publish_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_coords boolean;
  has_inclusion boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  has_coords := NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL;

  IF has_coords THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_geofences rg
    WHERE rg.restaurant_id = NEW.id
      AND rg.kind = 'inclusion'
  )
  INTO has_inclusion;

  IF has_inclusion THEN
    RETURN NEW;
  END IF;

  NEW.status := 'draft';
  NEW.is_active := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurants_publish_location_check ON public.restaurants;
CREATE TRIGGER restaurants_publish_location_check
  BEFORE INSERT OR UPDATE OF status, latitude, longitude
  ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.restaurant_enforce_publish_location();

-- When the last inclusion geofence is removed, a previously-published
-- restaurant with no GPS pin must drop back to draft so the rule holds.
CREATE OR REPLACE FUNCTION public.restaurant_geofence_demote_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  has_coords boolean;
  has_inclusion boolean;
BEGIN
  v_restaurant_id := COALESCE(OLD.restaurant_id, NEW.restaurant_id);
  IF v_restaurant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    (r.latitude IS NOT NULL AND r.longitude IS NOT NULL)
  INTO has_coords
  FROM public.restaurants r
  WHERE r.id = v_restaurant_id;

  IF has_coords IS NULL OR has_coords THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_geofences rg
    WHERE rg.restaurant_id = v_restaurant_id
      AND rg.kind = 'inclusion'
  )
  INTO has_inclusion;

  IF has_inclusion THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.restaurants
     SET status = 'draft',
         is_active = false,
         updated_at = now()
   WHERE id = v_restaurant_id
     AND status = 'published';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS restaurant_geofences_demote_publish ON public.restaurant_geofences;
CREATE TRIGGER restaurant_geofences_demote_publish
  AFTER DELETE OR UPDATE OF kind ON public.restaurant_geofences
  FOR EACH ROW
  EXECUTE FUNCTION public.restaurant_geofence_demote_publish();

COMMENT ON FUNCTION public.restaurant_enforce_publish_location() IS
  'Demote restaurants to draft when published without GPS pin or inclusion geofence.';
COMMENT ON FUNCTION public.restaurant_geofence_demote_publish() IS
  'Demote a published restaurant back to draft if its last inclusion geofence is removed and it has no GPS pin.';
