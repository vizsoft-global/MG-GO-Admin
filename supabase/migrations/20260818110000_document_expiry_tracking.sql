-- Document expiry tracking: canonical metadata for intake + linked driver documents.

CREATE TABLE IF NOT EXISTS public.document_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES public.driver_intakes(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  doc_type public.document_type NOT NULL,
  expires_at date,
  track_expiry boolean NOT NULL DEFAULT false,
  notify_enabled boolean NOT NULL DEFAULT true,
  notify_lead_days smallint[] NOT NULL DEFAULT '{30,14,7,1}',
  object_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_tracking_scope_check CHECK (
    intake_id IS NOT NULL OR driver_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS document_tracking_intake_doc_type_key
  ON public.document_tracking (intake_id, doc_type)
  WHERE intake_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_tracking_driver_doc_type_key
  ON public.document_tracking (driver_id, doc_type)
  WHERE driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_tracking_expires_at_idx
  ON public.document_tracking (expires_at)
  WHERE track_expiry = true AND expires_at IS NOT NULL;

COMMENT ON TABLE public.document_tracking IS
  'Per-document expiry metadata for admin compliance; spans intake and linked driver scope.';

ALTER TABLE public.document_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_tracking_staff_all ON public.document_tracking;
CREATE POLICY document_tracking_staff_all ON public.document_tracking
  FOR ALL
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('documents.view', 'View document expiry', 'compliance'),
  ('documents.manage', 'Manage document expiry', 'compliance')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- Carry intake tracking rows onto the linked driver profile on approve.
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

  -- Mirror expiry onto driver_documents when rows exist or will exist.
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
