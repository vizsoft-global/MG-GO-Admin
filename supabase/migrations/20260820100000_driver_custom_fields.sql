-- Dynamic custom fields (reusable definitions) + hybrid UI list prefs

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (char_length(trim(entity_type)) > 0),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text NOT NULL CHECK (char_length(trim(label)) > 0),
  field_type text NOT NULL CHECK (
    field_type IN ('text', 'number', 'select', 'date', 'checkbox')
  ),
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, key)
);

CREATE INDEX IF NOT EXISTS custom_field_definitions_entity_sort_idx
  ON public.custom_field_definitions (entity_type, sort_order)
  WHERE archived_at IS NULL;

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_definitions_staff_all ON public.custom_field_definitions;
CREATE POLICY custom_field_definitions_staff_all ON public.custom_field_definitions
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.admin_role_ui_defaults (
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  preference_key text NOT NULL CHECK (char_length(trim(preference_key)) > 0),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (role_id, preference_key)
);

ALTER TABLE public.admin_role_ui_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_role_ui_defaults_staff_read ON public.admin_role_ui_defaults;
CREATE POLICY admin_role_ui_defaults_staff_read ON public.admin_role_ui_defaults
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS admin_role_ui_defaults_staff_write ON public.admin_role_ui_defaults;
CREATE POLICY admin_role_ui_defaults_staff_write ON public.admin_role_ui_defaults
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

CREATE TABLE IF NOT EXISTS public.admin_ui_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL CHECK (char_length(trim(preference_key)) > 0),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_key)
);

ALTER TABLE public.admin_ui_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_ui_preferences_own ON public.admin_ui_preferences;
CREATE POLICY admin_ui_preferences_own ON public.admin_ui_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_panel_user())
  WITH CHECK (user_id = auth.uid() AND public.is_admin_panel_user());

-- Copy custom_fields on approve (latest admin_approve_driver body + custom_fields)
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

  IF v_intake.phone IS NULL OR trim(v_intake.phone) = ''
     OR v_intake.full_name IS NULL OR trim(v_intake.full_name) = ''
     OR v_intake.civil_id IS NULL OR trim(v_intake.civil_id) = ''
     OR v_intake.employee_id IS NULL OR trim(v_intake.employee_id) = '' THEN
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

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    locale,
    approval_status
  )
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    v_intake.full_name,
    v_intake.phone,
    'rider'::public.app_role,
    'en',
    'approved'::public.admin_approval_status
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'rider'::public.app_role,
    approval_status = 'approved'::public.admin_approval_status,
    updated_at = now();

  INSERT INTO public.drivers (
    id,
    driver_code,
    partner_id,
    zone_id,
    vehicle_id,
    civil_id,
    employee_id,
    nationality,
    rider_category,
    custom_fields,
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
    v_intake.nationality,
    v_intake.rider_category,
    COALESCE(v_intake.custom_fields, '{}'::jsonb),
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

  UPDATE public.document_tracking
  SET driver_id = p_user_id, updated_at = now()
  WHERE intake_id = p_intake_id;

  UPDATE public.driver_documents dd
  SET
    expires_at = dt.expires_at,
    updated_at = now()
  FROM public.document_tracking dt
  WHERE dt.driver_id = p_user_id
    AND dt.doc_type = dd.doc_type
    AND dt.track_expiry = true
    AND dt.expires_at IS NOT NULL;

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

COMMENT ON TABLE public.custom_field_definitions IS
  'Reusable custom field defs; entity_type scopes module (driver first).';
COMMENT ON COLUMN public.driver_intakes.custom_fields IS
  'JSON map of custom_field_definitions.key -> typed value';
COMMENT ON COLUMN public.drivers.custom_fields IS
  'JSON map of custom_field_definitions.key -> typed value';
