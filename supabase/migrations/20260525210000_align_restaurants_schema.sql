-- Align restaurants with admin panel schema (remote one-off migrations used status instead of is_active).

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurants'
      AND column_name = 'status'
  ) THEN
    UPDATE public.restaurants
    SET is_active = (status::text IN ('published', 'active'))
    WHERE status IS NOT NULL;
  END IF;
END $$;
