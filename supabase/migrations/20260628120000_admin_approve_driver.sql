-- Admin-first approval: link intake to pre-created auth user, activate driver, mint passcode.

CREATE OR REPLACE FUNCTION public.intake_has_active_restaurant(p_intake_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_intake_restaurants dir
    JOIN public.restaurants r ON r.id = dir.restaurant_id
    WHERE dir.intake_id = p_intake_id
      AND r.is_active = true
  );
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
    IF SQLERRM LIKE '%phone%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%driver_missing_active_restaurant%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_active_restaurant');
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.intake_has_active_restaurant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intake_has_active_restaurant(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_approve_driver(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_driver(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_approve_driver(uuid, uuid, text) IS
  'Staff-only: create profile + driver from intake, activate, mint passcode. Auth user must exist (created server-side).';
