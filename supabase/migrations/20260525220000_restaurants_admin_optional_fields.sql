-- Admin panel creates restaurants with partner + name only; remote schema required zone_id.
-- Some environments never had restaurants.zone_id; guard this migration for clean installs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurants'
      AND column_name = 'zone_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.restaurants ALTER COLUMN zone_id DROP NOT NULL';
  END IF;
END $$;
