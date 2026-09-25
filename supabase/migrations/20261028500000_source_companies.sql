-- Drivers SOP: controlled company list with one Client ID per company.
-- Replaces the hard-coded source_company CHECK with an FK so a company added
-- in settings is valid everywhere without a migration.
--
-- Only MG carries a Client ID (CL-0001, confirmed by the SOP). Every other
-- company's code stays NULL until Ops enters the real one. drivers.client_id /
-- client_name (Keeta / Americana platform data) are not touched.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.source_companies (
  key text PRIMARY KEY,
  name text NOT NULL,
  client_code text,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_companies_key_format CHECK (key ~ '^[a-z0-9_]{1,24}$'),
  CONSTRAINT source_companies_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT source_companies_client_code_format CHECK (
    client_code IS NULL OR client_code ~ '^[A-Z0-9-]{1,32}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS source_companies_client_code_uidx
  ON public.source_companies (client_code)
  WHERE client_code IS NOT NULL;

-- The eight keys the CHECK allowed. Existing rows are never overwritten.
INSERT INTO public.source_companies (key, name, client_code, is_system, sort_order)
VALUES
  ('mg', 'MG', 'CL-0001', true, 0),
  ('kn', 'KN', NULL, false, 10),
  ('rvd', 'RVD', NULL, false, 20),
  ('sadeeq', 'Sadeeq', NULL, false, 30),
  ('brk', 'BRK', NULL, false, 40),
  ('hs', 'HS', NULL, false, 50),
  ('ar', 'AR', NULL, false, 60),
  ('zk', 'ZK', NULL, false, 70)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_source_company_check;
ALTER TABLE public.driver_intakes DROP CONSTRAINT IF EXISTS driver_intakes_source_company_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drivers_source_company_fkey'
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_source_company_fkey
      FOREIGN KEY (source_company) REFERENCES public.source_companies (key)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_intakes_source_company_fkey'
  ) THEN
    ALTER TABLE public.driver_intakes
      ADD CONSTRAINT driver_intakes_source_company_fkey
      FOREIGN KEY (source_company) REFERENCES public.source_companies (key)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- Guard: key is immutable, the MG row is locked, and a company still used by a
-- live driver cannot be deactivated (SOP edge case, Ops chose "block").
CREATE OR REPLACE FUNCTION public.source_companies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source_company_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'source_company_key_immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_system AND (
      NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.client_code IS DISTINCT FROM OLD.client_code
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.is_system IS DISTINCT FROM OLD.is_system
    ) THEN
      RAISE EXCEPTION 'source_company_system_locked' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active AND (
      EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.source_company = OLD.key AND d.archived_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.driver_intakes i
        WHERE i.source_company = OLD.key AND i.archived_at IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'source_company_in_use' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_companies_guard_trg ON public.source_companies;
CREATE TRIGGER source_companies_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.source_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.source_companies_guard();

ALTER TABLE public.source_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS source_companies_staff_select ON public.source_companies;
CREATE POLICY source_companies_staff_select
  ON public.source_companies
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

REVOKE ALL ON public.source_companies FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.source_companies FROM authenticated;
GRANT SELECT ON public.source_companies TO authenticated;

-- Only write path. Normalises the code (trim + uppercase, blank = NULL).
CREATE OR REPLACE FUNCTION public.admin_upsert_source_company(
  p_key text,
  p_name text,
  p_client_code text,
  p_is_active boolean,
  p_sort_order integer DEFAULT NULL
)
RETURNS public.source_companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(upper(btrim(coalesce(p_client_code, ''))), '');
  v_row public.source_companies;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('settings.manage') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[a-z0-9_]{1,24}$' THEN
    RAISE EXCEPTION 'invalid_company_key' USING ERRCODE = 'P0001';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[A-Z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_client_code' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.source_companies c
    WHERE c.client_code = v_code AND c.key <> v_key
  ) THEN
    RAISE EXCEPTION 'client_code_taken' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.source_companies AS c (key, name, client_code, is_active, sort_order)
  VALUES (v_key, v_name, v_code, coalesce(p_is_active, true), coalesce(p_sort_order, 100))
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        client_code = EXCLUDED.client_code,
        is_active = EXCLUDED.is_active,
        sort_order = coalesce(p_sort_order, c.sort_order)
  RETURNING c.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer) TO authenticated;

COMMENT ON TABLE public.source_companies IS
  'Rider employer companies (MG + outsourcing partners). Client ID = client_code, one per company. In-house riders always resolve to key mg.';
