-- Vehicles: plate is the unique business ID, All Uses is a catalog,
-- and per-vehicle handover / accident / document / service ledgers.
-- Additive. Does not touch deliveries.shift_date (20261030600000).

UPDATE public.vehicles
SET reg_number = NULL
WHERE reg_number IS NOT NULL AND btrim(reg_number) = '';

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_reg_number_not_blank;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_reg_number_not_blank
  CHECK (reg_number IS NULL OR btrim(reg_number) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_reg_number_normalized_uidx
  ON public.vehicles (lower(btrim(reg_number)))
  WHERE reg_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vehicle_use_types (
  key text PRIMARY KEY,
  label_en text NOT NULL,
  label_ar text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_use_types_key_format CHECK (key ~ '^[a-z0-9_]{1,24}$'),
  CONSTRAINT vehicle_use_types_label_en_not_blank CHECK (btrim(label_en) <> '' AND char_length(label_en) <= 80),
  CONSTRAINT vehicle_use_types_label_ar_not_blank CHECK (btrim(label_ar) <> '' AND char_length(label_ar) <= 80)
);

INSERT INTO public.vehicle_use_types (key, label_en, label_ar, is_system, sort_order)
VALUES
  ('operational', 'Operational', 'تشغيلي', true, 10),
  ('trainer', 'Trainer', 'تدريب', true, 20),
  ('standby', 'Standby use', 'احتياطي', true, 30)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.vehicle_use_types (key, label_en, label_ar, is_system, sort_order, is_active)
SELECT DISTINCT
  v.type_of_use,
  initcap(replace(v.type_of_use, '_', ' ')),
  v.type_of_use,
  false,
  200,
  true
FROM public.vehicles v
WHERE v.type_of_use IS NOT NULL
  AND v.type_of_use ~ '^[a-z0-9_]{1,24}$'
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_type_of_use_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_type_of_use_fkey'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_type_of_use_fkey
      FOREIGN KEY (type_of_use) REFERENCES public.vehicle_use_types (key)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.vehicle_use_types_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vehicle_use_type_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'vehicle_use_type_key_immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_system AND NEW.is_system IS DISTINCT FROM OLD.is_system THEN
      RAISE EXCEPTION 'vehicle_use_type_system_locked' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active AND EXISTS (
      SELECT 1 FROM public.vehicles v WHERE v.type_of_use = OLD.key
    ) THEN
      RAISE EXCEPTION 'vehicle_use_type_in_use' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_use_types_guard_trg ON public.vehicle_use_types;
CREATE TRIGGER vehicle_use_types_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.vehicle_use_types
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicle_use_types_guard();

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_use_type(
  p_key text,
  p_label_en text,
  p_label_ar text,
  p_is_active boolean,
  p_sort_order integer DEFAULT NULL
)
RETURNS public.vehicle_use_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_en text := btrim(coalesce(p_label_en, ''));
  v_ar text := btrim(coalesce(p_label_ar, ''));
  v_row public.vehicle_use_types;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('settings.manage') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[a-z0-9_]{1,24}$' THEN
    RAISE EXCEPTION 'invalid_use_type_key' USING ERRCODE = 'P0001';
  END IF;
  IF v_en = '' OR char_length(v_en) > 80 THEN
    RAISE EXCEPTION 'invalid_use_type_label' USING ERRCODE = 'P0001';
  END IF;
  IF v_ar = '' THEN
    v_ar := v_en;
  END IF;
  IF char_length(v_ar) > 80 THEN
    RAISE EXCEPTION 'invalid_use_type_label' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.vehicle_use_types (key, label_en, label_ar, is_active, sort_order)
  VALUES (v_key, v_en, v_ar, coalesce(p_is_active, true), coalesce(p_sort_order, 100))
  ON CONFLICT (key) DO UPDATE
    SET label_en = excluded.label_en,
        label_ar = excluded.label_ar,
        is_active = excluded.is_active,
        sort_order = coalesce(p_sort_order, public.vehicle_use_types.sort_order)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle_use_type(text, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_use_type(text, text, text, boolean, integer) TO authenticated;

ALTER TABLE public.vehicle_use_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_use_types_staff_all ON public.vehicle_use_types;
CREATE POLICY vehicle_use_types_staff_all
  ON public.vehicle_use_types
  FOR ALL
  TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

REVOKE ALL ON public.vehicle_use_types FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_use_types TO authenticated;

CREATE TABLE IF NOT EXISTS public.vehicle_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  handed_at timestamptz NOT NULL DEFAULT now(),
  from_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  to_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  notes text,
  storage_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_handovers_vehicle_idx
  ON public.vehicle_handovers (vehicle_id, handed_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  location_text text,
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high')),
  notes text,
  storage_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_accidents_vehicle_idx
  ON public.vehicle_accidents (vehicle_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  storage_key text NOT NULL,
  file_name text,
  expires_at date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_documents_doc_type_not_blank CHECK (btrim(doc_type) <> '' AND char_length(doc_type) <= 64)
);

CREATE INDEX IF NOT EXISTS vehicle_documents_vehicle_idx
  ON public.vehicle_documents (vehicle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  serviced_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'service',
  odometer integer,
  vendor text,
  cost_kwd numeric(12,3),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_services_kind_not_blank CHECK (btrim(kind) <> '' AND char_length(kind) <= 64)
);

CREATE INDEX IF NOT EXISTS vehicle_services_vehicle_idx
  ON public.vehicle_services (vehicle_id, serviced_at DESC);

ALTER TABLE public.vehicle_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_accidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_handovers_staff_all ON public.vehicle_handovers;
CREATE POLICY vehicle_handovers_staff_all ON public.vehicle_handovers
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS vehicle_accidents_staff_all ON public.vehicle_accidents;
CREATE POLICY vehicle_accidents_staff_all ON public.vehicle_accidents
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS vehicle_documents_staff_all ON public.vehicle_documents;
CREATE POLICY vehicle_documents_staff_all ON public.vehicle_documents
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS vehicle_services_staff_all ON public.vehicle_services;
CREATE POLICY vehicle_services_staff_all ON public.vehicle_services
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

REVOKE ALL ON public.vehicle_handovers FROM anon;
REVOKE ALL ON public.vehicle_accidents FROM anon;
REVOKE ALL ON public.vehicle_documents FROM anon;
REVOKE ALL ON public.vehicle_services FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_handovers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_accidents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_services TO authenticated;

COMMENT ON COLUMN public.vehicles.reg_number IS
  'Kuwait plate. Unique business Vehicle ID. bike_id is the slug alias.';
COMMENT ON TABLE public.vehicle_use_types IS
  'Admin-managed Type of Use / All Uses catalog for vehicles.type_of_use.';
