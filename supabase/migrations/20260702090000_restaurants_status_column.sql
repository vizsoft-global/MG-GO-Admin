-- Fresh projects: align restaurants.status with publish workflow (testing had remote one-off).
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

UPDATE public.restaurants
SET status = CASE WHEN is_active THEN 'published' ELSE 'draft' END
WHERE status IS NULL OR status = 'draft';
