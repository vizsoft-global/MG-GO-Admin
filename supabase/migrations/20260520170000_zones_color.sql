-- Zone display color on maps (hex #RRGGBB)

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#EF5B4D';

COMMENT ON COLUMN public.zones.color IS 'Hex color (#RRGGBB) for map and list display';

-- Assign distinct palette colors to existing rows
DO $$
DECLARE
  palette text[] := ARRAY[
    '#EF5B4D', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'
  ];
  rec record;
  idx int := 0;
BEGIN
  FOR rec IN
    SELECT id FROM public.zones ORDER BY created_at, id
  LOOP
    UPDATE public.zones
    SET color = palette[1 + (idx % array_length(palette, 1))]
    WHERE id = rec.id;
    idx := idx + 1;
  END LOOP;
END $$;
