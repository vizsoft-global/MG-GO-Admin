-- Delivery proximity: context RPC + server enforcement on create.

-- Build zone geography from GeoJSON Feature (polygon or circle).
CREATE OR REPLACE FUNCTION public._zone_geography_from_feature(
  p_geometry jsonb,
  p_zone_type public.zone_geometry_type
)
RETURNS extensions.geography
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_geom geometry;
  v_radius numeric;
  v_geo jsonb;
BEGIN
  IF p_geometry IS NULL THEN
    RETURN NULL;
  END IF;

  v_geo := CASE
    WHEN p_geometry->>'type' = 'Feature' THEN p_geometry->'geometry'
    ELSE p_geometry
  END;

  IF v_geo IS NULL OR v_geo = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  IF p_zone_type = 'circle' THEN
    IF (v_geo->>'type') IS DISTINCT FROM 'Point' THEN
      RETURN NULL;
    END IF;
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(v_geo), 4326);
    v_radius := NULLIF(trim(p_geometry->'properties'->>'radiusMeters'), '')::numeric;
    IF v_radius IS NULL OR v_radius <= 0 THEN
      RETURN NULL;
    END IF;
    RETURN ST_Buffer(v_geom::extensions.geography, v_radius);
  END IF;

  IF (v_geo->>'type') IS DISTINCT FROM 'Polygon' THEN
    RETURN NULL;
  END IF;

  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(v_geo), 4326);
  RETURN v_geom::extensions.geography;
END;
$$;

-- True when point is inside zone OR within buffer meters of zone boundary.
CREATE OR REPLACE FUNCTION public._point_within_zone_proximity(
  p_lat double precision,
  p_lng double precision,
  p_geometry jsonb,
  p_zone_type public.zone_geometry_type,
  p_buffer_meters integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_zone extensions.geography;
  v_point extensions.geography;
BEGIN
  v_zone := public._zone_geography_from_feature(p_geometry, p_zone_type);
  IF v_zone IS NULL THEN
    RETURN false;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;
  RETURN ST_DWithin(v_point, v_zone, GREATEST(p_buffer_meters, 0));
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
  v_point extensions.geography;
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

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;

  SELECT EXISTS (
    SELECT 1
    FROM public.driver_restaurants dr
    JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = p_driver_id
      AND r.latitude IS NOT NULL
      AND r.longitude IS NOT NULL
      AND ST_DWithin(
        v_point,
        ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::extensions.geography,
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
            'longitude', r.longitude
          )
          ORDER BY r.name
        )
        FROM public.driver_restaurants dr
        JOIN public.restaurants r ON r.id = dr.restaurant_id
        WHERE dr.driver_id = v_uid
          AND r.latitude IS NOT NULL
          AND r.longitude IS NOT NULL
      ),
      '[]'::jsonb
    )
  );
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
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text;
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_proximity integer;
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

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    RAISE EXCEPTION 'location_required' USING MESSAGE = 'GPS location is required';
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity > 0
     AND NOT public.driver_is_within_delivery_range(
       v_uid,
       p_delivered_lat::double precision,
       p_delivered_lng::double precision,
       v_proximity
     ) THEN
    RAISE EXCEPTION 'delivery_out_of_range'
      USING MESSAGE = 'You are outside the allowed delivery area';
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

GRANT EXECUTE ON FUNCTION public.driver_get_delivery_proximity_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_is_within_delivery_range(uuid, double precision, double precision, integer) TO authenticated;
