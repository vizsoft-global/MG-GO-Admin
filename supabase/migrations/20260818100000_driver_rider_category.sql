-- Rider employment category: in-house vs outsourced.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_rider_category') THEN
    CREATE TYPE public.driver_rider_category AS ENUM ('in_house', 'outsourced');
  END IF;
END $$;

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS rider_category public.driver_rider_category NOT NULL DEFAULT 'in_house';

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS rider_category public.driver_rider_category NOT NULL DEFAULT 'in_house';

COMMENT ON COLUMN public.driver_intakes.rider_category IS
  'Employment category: in_house (direct) or outsourced (third-party).';

COMMENT ON COLUMN public.drivers.rider_category IS
  'Employment category; copied from intake on approve.';

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
