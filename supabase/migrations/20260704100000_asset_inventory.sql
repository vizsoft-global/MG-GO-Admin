-- Asset inventory catalog + quantity-based assignments for drivers/intakes.

DO $$ BEGIN
  CREATE TYPE public.asset_assignment_status AS ENUM ('assigned', 'returned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.asset_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  description text,
  icon_key text NOT NULL DEFAULT 'Package',
  total_quantity integer NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  reorder_level integer NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_catalog_code_unique UNIQUE (code)
);

COMMENT ON TABLE public.asset_catalog IS 'Admin-managed driver equipment catalog with stock counts';

CREATE TABLE IF NOT EXISTS public.asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid NOT NULL REFERENCES public.asset_catalog(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status public.asset_assignment_status NOT NULL DEFAULT 'assigned',
  intake_id uuid REFERENCES public.driver_intakes(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_assignments_holder_check CHECK (
    intake_id IS NOT NULL OR driver_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS asset_assignments_catalog_status_idx
  ON public.asset_assignments (catalog_item_id, status);

CREATE INDEX IF NOT EXISTS asset_assignments_intake_idx
  ON public.asset_assignments (intake_id)
  WHERE intake_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS asset_assignments_driver_idx
  ON public.asset_assignments (driver_id)
  WHERE driver_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_assignments_active_intake_item_uidx
  ON public.asset_assignments (intake_id, catalog_item_id)
  WHERE status = 'assigned' AND intake_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_assignments_active_driver_item_uidx
  ON public.asset_assignments (driver_id, catalog_item_id)
  WHERE status = 'assigned' AND driver_id IS NOT NULL;

ALTER TABLE public.asset_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'asset_catalog' AND policyname = 'staff_all_asset_catalog'
  ) THEN
    CREATE POLICY staff_all_asset_catalog ON public.asset_catalog
      FOR ALL TO authenticated
      USING (public.is_admin_panel_user())
      WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'asset_assignments' AND policyname = 'staff_all_asset_assignments'
  ) THEN
    CREATE POLICY staff_all_asset_assignments ON public.asset_assignments
      FOR ALL TO authenticated
      USING (public.is_admin_panel_user())
      WITH CHECK (public.is_admin_panel_user());
  END IF;
END $$;

INSERT INTO public.admin_permissions (slug, label, category)
VALUES
  ('assets.view', 'View assets', 'assets'),
  ('assets.manage', 'Manage assets', 'assets')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.asset_catalog (name, code, description, icon_key, total_quantity, reorder_level, is_active)
VALUES
  ('GPS device', 'gps', 'Vehicle GPS tracker', 'Navigation', 0, 5, true),
  ('SIM card', 'sim', 'Driver SIM card', 'Smartphone', 0, 10, true),
  ('Phone', 'phone', 'Company phone handset', 'Phone', 0, 5, true),
  ('Delivery bag', 'delivery_bag', 'Insulated delivery bag', 'ShoppingBag', 0, 10, true),
  ('Helmet', 'helmet', 'Safety helmet', 'HardHat', 0, 10, true),
  ('Uniform', 'uniform', 'Driver uniform set', 'Shirt', 0, 10, true)
ON CONFLICT (code) DO NOTHING;

-- Backfill from driver_intakes.assets_issued jsonb
INSERT INTO public.asset_assignments (
  catalog_item_id,
  quantity,
  status,
  intake_id,
  driver_id,
  assigned_at
)
SELECT
  ac.id,
  1,
  'assigned'::public.asset_assignment_status,
  di.id,
  CASE WHEN di.linked = true THEN di.linked_profile_id ELSE NULL END,
  COALESCE(di.updated_at, di.created_at)
FROM public.driver_intakes di
CROSS JOIN LATERAL (
  SELECT key AS asset_key, (di.assets_issued ->> key)::boolean AS issued
  FROM jsonb_object_keys(COALESCE(di.assets_issued, '{}'::jsonb)) AS key
) AS flags
JOIN public.asset_catalog ac ON ac.code = flags.asset_key
WHERE flags.issued IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.asset_assignments aa
    WHERE aa.intake_id = di.id
      AND aa.catalog_item_id = ac.id
      AND aa.status = 'assigned'
  );

-- Link assignments to drivers on approve
CREATE OR REPLACE FUNCTION public.sync_intake_asset_assignments_to_driver(
  p_intake_id uuid,
  p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.asset_assignments
  SET
    driver_id = p_driver_id,
    updated_at = now()
  WHERE intake_id = p_intake_id
    AND status = 'assigned'::public.asset_assignment_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_driver(
  p_intake_id uuid,
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intake public.driver_intakes%ROWTYPE;
  v_passcode text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_user_id IS NULL OR p_intake_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  SELECT * INTO v_intake
  FROM public.driver_intakes
  WHERE id = p_intake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  IF v_intake.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_archived');
  END IF;

  IF v_intake.linked = true OR v_intake.linked_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  IF v_intake.phone IS NULL OR v_intake.full_name IS NULL OR v_intake.civil_id IS NULL
     OR v_intake.partner_id IS NULL OR v_intake.zone_id IS NULL OR v_intake.employee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF NOT public.intake_has_active_restaurant(p_intake_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_active_restaurant');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.phone = v_intake.phone AND p.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
  END IF;

  IF EXISTS (SELECT 1 FROM public.drivers WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  INSERT INTO public.profiles (id, email, full_name, phone, role, locale)
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    v_intake.full_name,
    v_intake.phone,
    'rider'::public.app_role,
    'en'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'rider'::public.app_role,
    updated_at = now();

  INSERT INTO public.drivers (
    id,
    driver_code,
    partner_id,
    zone_id,
    vehicle_id,
    civil_id,
    employee_id,
    status,
    is_on_duty
  )
  VALUES (
    p_user_id,
    v_intake.driver_code,
    v_intake.partner_id,
    v_intake.zone_id,
    v_intake.vehicle_id,
    v_intake.civil_id,
    v_intake.employee_id,
    'pending'::public.driver_status,
    false
  );

  INSERT INTO public.driver_restaurants (driver_id, restaurant_id)
  SELECT p_user_id, dir.restaurant_id
  FROM public.driver_intake_restaurants dir
  WHERE dir.intake_id = p_intake_id
  ON CONFLICT DO NOTHING;

  PERFORM public.sync_intake_asset_assignments_to_driver(p_intake_id, p_user_id);

  UPDATE public.drivers
  SET status = 'active'::public.driver_status, updated_at = now()
  WHERE id = p_user_id;

  SELECT app_passcode INTO v_passcode
  FROM public.drivers
  WHERE id = p_user_id;

  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_user_id,
    workflow_status = 'approved'::public.driver_workflow_status,
    status = 'linked'::public.driver_intake_status,
    updated_at = now()
  WHERE id = p_intake_id;

  RETURN jsonb_build_object(
    'ok', true,
    'driver_id', p_user_id,
    'driver_code', v_intake.driver_code,
    'app_passcode', v_passcode
  );
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%employee_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'employee_id_exists');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_driver_intake_linked(
  p_phone text,
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
  v_intake_id uuid;
BEGIN
  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_profile_id,
    status = 'linked',
    updated_at = now()
  WHERE phone = p_phone
    AND linked = false;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    SELECT di.id INTO v_intake_id
    FROM public.driver_intakes di
    WHERE di.phone = p_phone
      AND di.linked_profile_id = p_profile_id
    ORDER BY di.updated_at DESC
    LIMIT 1;

    INSERT INTO public.driver_restaurants (driver_id, restaurant_id)
    SELECT p_profile_id, dir.restaurant_id
    FROM public.driver_intake_restaurants dir
    JOIN public.driver_intakes di ON di.id = dir.intake_id
    WHERE di.phone = p_phone
      AND di.linked_profile_id = p_profile_id
    ON CONFLICT (driver_id, restaurant_id) DO NOTHING;

    IF v_intake_id IS NOT NULL THEN
      PERFORM public.sync_intake_asset_assignments_to_driver(v_intake_id, p_profile_id);
    END IF;
  END IF;

  RETURN updated_count > 0;
END;
$$;
