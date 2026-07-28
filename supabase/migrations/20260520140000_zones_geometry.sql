-- Zones: support polygon and circle geometries via GeoJSON Feature

DO $$ BEGIN
  CREATE TYPE public.zone_geometry_type AS ENUM ('polygon', 'circle');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS zone_type public.zone_geometry_type NOT NULL DEFAULT 'polygon',
  ADD COLUMN IF NOT EXISTS geometry jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill code for existing rows (remote may lack code column entirely)
UPDATE public.zones
SET code = 'ZN-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE code IS NULL;

ALTER TABLE public.zones ALTER COLUMN code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS zones_code_key ON public.zones (code);

-- Legacy: backfill from polygon column when present (fresh installs from dpd_core_schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'zones' AND column_name = 'polygon'
  ) THEN
    EXECUTE $sql$
      UPDATE public.zones SET geometry = polygon
      WHERE polygon IS NOT NULL AND geometry IS NULL
    $sql$;
    ALTER TABLE public.zones DROP COLUMN polygon;
  END IF;
END $$;

COMMENT ON COLUMN public.zones.geometry IS 'GeoJSON Feature: Polygon geometry for polygon zones; Point + properties.radiusMeters for circle zones';
COMMENT ON COLUMN public.zones.zone_type IS 'polygon | circle — must match geometry shape';
