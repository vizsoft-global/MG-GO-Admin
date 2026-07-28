-- Restaurant geofences: per-restaurant inclusion/exclusion polygons and circles.

DO $$ BEGIN
  CREATE TYPE public.restaurant_geofence_kind AS ENUM ('inclusion', 'exclusion');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.restaurant_geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  kind public.restaurant_geofence_kind NOT NULL,
  zone_type public.zone_geometry_type NOT NULL,
  geometry jsonb NOT NULL,
  name text,
  color text NOT NULL DEFAULT '#22c55e',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.restaurant_geofences IS
  'Inclusion/exclusion delivery areas per restaurant (GeoJSON Feature, polygon or circle).';

CREATE INDEX IF NOT EXISTS restaurant_geofences_restaurant_id_idx
  ON public.restaurant_geofences (restaurant_id);

ALTER TABLE public.restaurant_geofences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_geofences'
      AND policyname = 'staff_all_restaurant_geofences'
  ) THEN
    CREATE POLICY staff_all_restaurant_geofences ON public.restaurant_geofences
      FOR ALL TO authenticated
      USING (public.is_admin_panel_user())
      WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_geofences'
      AND policyname = 'drivers_read_linked_restaurant_geofences'
  ) THEN
    CREATE POLICY drivers_read_linked_restaurant_geofences ON public.restaurant_geofences
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.driver_restaurants dr
          WHERE dr.restaurant_id = restaurant_geofences.restaurant_id
            AND dr.driver_id = auth.uid()
        )
      );
  END IF;
END $$;

-- True when point is inside a restaurant geofence (no proximity buffer).
CREATE OR REPLACE FUNCTION public._point_in_restaurant_geofence(
  p_lat double precision,
  p_lng double precision,
  p_geometry jsonb,
  p_zone_type public.zone_geometry_type
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN public._point_within_zone_proximity(p_lat, p_lng, p_geometry, p_zone_type, 0);
END;
$$;

-- True when driver delivery point is allowed for a linked restaurant.
CREATE OR REPLACE FUNCTION public._driver_restaurant_delivery_allowed(
  p_driver_id uuid,
  p_restaurant_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_proximity_meters integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_has_inclusion boolean := false;
  v_in_inclusion boolean := false;
  v_in_exclusion boolean := false;
  v_point extensions.geography;
  v_near_pin boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_geofences rg
    WHERE rg.restaurant_id = p_restaurant_id
      AND rg.kind = 'inclusion'
  ) INTO v_has_inclusion;

  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_geofences rg
    WHERE rg.restaurant_id = p_restaurant_id
      AND rg.kind = 'inclusion'
      AND public._point_in_restaurant_geofence(p_lat, p_lng, rg.geometry, rg.zone_type)
  ) INTO v_in_inclusion;

  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_geofences rg
    WHERE rg.restaurant_id = p_restaurant_id
      AND rg.kind = 'exclusion'
      AND public._point_in_restaurant_geofence(p_lat, p_lng, rg.geometry, rg.zone_type)
  ) INTO v_in_exclusion;

  IF v_in_exclusion THEN
    RETURN false;
  END IF;

  IF v_has_inclusion THEN
    RETURN v_in_inclusion;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;

  SELECT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id
      AND r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND ST_DWithin(
        v_point,
        ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::extensions.geography,
        GREATEST(p_proximity_meters, 0)
      )
  ) INTO v_near_pin;

  RETURN v_near_pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_is_within_delivery_range(
  p_driver_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_proximity_meters integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_proximity integer;
  v_driver public.drivers%ROWTYPE;
  v_zone public.zones%ROWTYPE;
  v_near_zone boolean := false;
  v_near_restaurant boolean := false;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN false;
  END IF;

  v_proximity := COALESCE(
    p_proximity_meters,
    (SELECT driver_app_delivery_proximity_meters FROM public.app_settings WHERE id = 1),
    500
  );

  IF v_proximity <= 0 THEN
    RETURN true;
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_driver.zone_id IS NOT NULL THEN
    SELECT * INTO v_zone FROM public.zones WHERE id = v_driver.zone_id;
    IF FOUND THEN
      v_near_zone := public._point_within_zone_proximity(
        p_lat,
        p_lng,
        v_zone.geometry,
        v_zone.zone_type,
        v_proximity
      );
    END IF;
  END IF;

  IF v_near_zone THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.driver_restaurants dr
    WHERE dr.driver_id = p_driver_id
      AND public._driver_restaurant_delivery_allowed(
        p_driver_id,
        dr.restaurant_id,
        p_lat,
        p_lng,
        v_proximity
      )
  ) INTO v_near_restaurant;

  RETURN v_near_restaurant;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_delivery_proximity_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_zone_type text;
  v_zone_geometry jsonb;
  v_proximity integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_driver.zone_id IS NOT NULL THEN
    SELECT z.zone_type::text, z.geometry
    INTO v_zone_type, v_zone_geometry
    FROM public.zones z
    WHERE z.id = v_driver.zone_id;
  END IF;

  RETURN jsonb_build_object(
    'proximity_meters', v_proximity,
    'zone_id', v_driver.zone_id,
    'zone_type', v_zone_type,
    'zone_geometry', v_zone_geometry,
    'restaurants', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'name', r.name,
            'latitude', r.latitude,
            'longitude', r.longitude,
            'geofences', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', rg.id,
                    'kind', rg.kind,
                    'zone_type', rg.zone_type,
                    'geometry', rg.geometry,
                    'name', rg.name,
                    'color', rg.color
                  )
                  ORDER BY rg.created_at
                )
                FROM public.restaurant_geofences rg
                WHERE rg.restaurant_id = r.id
              ),
              '[]'::jsonb
            )
          )
          ORDER BY r.name
        )
        FROM public.driver_restaurants dr
        JOIN public.restaurants r ON r.id = dr.restaurant_id
        WHERE dr.driver_id = v_uid
      ),
      '[]'::jsonb
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._point_in_restaurant_geofence(double precision, double precision, jsonb, public.zone_geometry_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_restaurant_delivery_allowed(uuid, uuid, double precision, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_is_within_delivery_range(uuid, double precision, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_delivery_proximity_context() TO authenticated;
