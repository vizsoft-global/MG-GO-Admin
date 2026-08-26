-- Client ID and Client name on a driver.
--
-- Free text, optional, and deliberately NOT unique: these name the company the
-- rider is supplied to, so every outsourced rider on the same contract shares
-- one pair. Adding a unique index here would make the second rider of a client
-- unsaveable, which is the opposite of what the field is for.
--
-- Absent is NULL, never ''. Nothing depends on that for correctness the way the
-- phone and civil ID unique indexes do, but two spellings of "empty" means
-- every reader needs a COALESCE and every filter needs to remember both, so the
-- CHECK keeps one representation.

ALTER TABLE public.driver_intakes ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE public.driver_intakes ADD COLUMN IF NOT EXISTS client_name text;

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS client_name text;

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_client_id_chk;
ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_client_id_chk
  CHECK (client_id IS NULL OR (btrim(client_id) <> '' AND length(client_id) <= 64));

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_client_name_chk;
ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_client_name_chk
  CHECK (client_name IS NULL OR (btrim(client_name) <> '' AND length(client_name) <= 120));

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_client_id_chk;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_client_id_chk
  CHECK (client_id IS NULL OR (btrim(client_id) <> '' AND length(client_id) <= 64));

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_client_name_chk;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_client_name_chk
  CHECK (client_name IS NULL OR (btrim(client_name) <> '' AND length(client_name) <= 120));

COMMENT ON COLUMN public.drivers.client_id IS
  'Optional free-text identifier of the client this rider is supplied to. Shared across riders on the same contract, so not unique.';

-- Approve copies the intake onto the driver row; without this the two fields
-- would be captured at Add Driver and then silently lost the moment the rider
-- was activated.
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
  v_avatar text;
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

  -- Name and employee ID only. Employee ID is the app credential; phone and
  -- civil ID are contact details the panel can fill in later.
  IF v_intake.full_name IS NULL OR trim(v_intake.full_name) = ''
     OR v_intake.employee_id IS NULL OR trim(v_intake.employee_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF NOT public.intake_has_active_restaurant(p_intake_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_active_restaurant');
  END IF;

  -- Only a real number can be taken. Without the guard every phone-less
  -- approval after the first would collide on NULL = NULL and report
  -- phone_exists.
  IF v_intake.phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.phone = v_intake.phone AND p.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
  END IF;

  IF v_intake.civil_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.civil_id = v_intake.civil_id AND d.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
  END IF;

  IF EXISTS (SELECT 1 FROM public.drivers WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  v_avatar := NULLIF(btrim(COALESCE(v_intake.avatar_url, '')), '');

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    locale,
    approval_status,
    avatar_url
  )
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    v_intake.full_name,
    v_intake.phone,
    'rider'::public.app_role,
    'en',
    'approved'::public.admin_approval_status,
    v_avatar
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'rider'::public.app_role,
    approval_status = 'approved'::public.admin_approval_status,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
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
    client_id,
    client_name,
    custom_fields,
    status,
    is_on_duty,
    avatar_object_key,
    avatar_updated_at
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
    v_intake.client_id,
    v_intake.client_name,
    COALESCE(v_intake.custom_fields, '{}'::jsonb),
    'pending'::public.driver_status,
    false,
    v_avatar,
    CASE WHEN v_avatar IS NOT NULL THEN now() ELSE NULL END
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
    IF SQLERRM LIKE '%civil_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
    END IF;
    IF SQLERRM LIKE '%phone%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
END;
$$;

COMMENT ON FUNCTION public.admin_approve_driver(uuid, uuid, text) IS
  'Approve a driver intake. Requires full name + employee ID; phone and civil ID are optional but must be unique when present. Copies client ID / client name onto the driver row.';
