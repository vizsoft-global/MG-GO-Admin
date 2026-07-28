-- Zones are global delivery areas; company_id is optional (no admin company assignment required).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zones'
      AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.zones ALTER COLUMN company_id DROP NOT NULL;
  END IF;
END $$;
