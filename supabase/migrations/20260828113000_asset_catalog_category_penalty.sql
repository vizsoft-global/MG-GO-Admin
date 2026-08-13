-- Asset catalog: free-form category grouping + penalty charged when an item is lost/damaged.
-- Both columns are nullable so existing rows stay valid and render as "not set" in admin UI.

ALTER TABLE public.asset_catalog
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS penalty_kwd numeric(10, 3);

DO $$ BEGIN
  ALTER TABLE public.asset_catalog
    ADD CONSTRAINT asset_catalog_penalty_non_negative
    CHECK (penalty_kwd IS NULL OR penalty_kwd >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.asset_catalog.category IS 'Free-form grouping label (e.g. Safety gear, Devices, Uniform); null when not set';
COMMENT ON COLUMN public.asset_catalog.penalty_kwd IS 'Penalty charged to the driver for loss/damage, in KWD; null when not set';

CREATE INDEX IF NOT EXISTS asset_catalog_category_idx
  ON public.asset_catalog (category)
  WHERE category IS NOT NULL;
