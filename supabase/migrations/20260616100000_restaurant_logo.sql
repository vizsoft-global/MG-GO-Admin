-- Optional logo for restaurants (R2 key stored in logo_url).

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.restaurants.logo_url IS 'R2 object key (restaurants/{id}/logo.ext) or legacy public URL';
