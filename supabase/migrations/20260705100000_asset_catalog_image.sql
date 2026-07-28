-- Optional custom icon/image per asset catalog item (R2 object key in image_url).

ALTER TABLE public.asset_catalog
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.asset_catalog.image_url IS 'R2 object key for custom asset icon/image; Lucide icon_key used when null';
