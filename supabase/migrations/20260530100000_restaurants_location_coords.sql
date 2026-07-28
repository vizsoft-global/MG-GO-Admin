-- Restaurant GPS coordinates for map pin + future driver app logic

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_lat_range,
  DROP CONSTRAINT IF EXISTS restaurants_lng_range,
  DROP CONSTRAINT IF EXISTS restaurants_latlng_pair;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_lat_range
    CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  ADD CONSTRAINT restaurants_lng_range
    CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  ADD CONSTRAINT restaurants_latlng_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL));
