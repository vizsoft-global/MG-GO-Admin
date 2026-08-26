-- Mobile number and Civil ID become optional on a driver, but stay unique.
--
-- Neither is an auth factor: the app logs in with employee ID + 6-digit
-- passcode (`driver_app_lookup_by_passcode`), so a driver with no phone can
-- still sign in. Employee ID remains mandatory and unique — that is the
-- credential, and it is the one identity field that may not be dropped.
--
-- Uniqueness has to survive the columns becoming nullable, and the two halves
-- of that are different problems:
--
--   * Phone already carries `driver_intakes_phone_unique`. SQL treats NULLs as
--     distinct, so any number of intakes may have no phone while two intakes
--     still cannot share one. The trap is the *empty string*: '' is a value,
--     so a second phone-less intake written as '' would collide and report
--     "phone already exists" for a field nobody filled in. The CHECK below is
--     what makes that unrepresentable rather than merely discouraged.
--
--   * Civil ID had no database constraint at all — it was deduplicated only in
--     admin TypeScript (`civilIdExists`), so anything writing outside that path
--     could duplicate it silently. It gets real indexes here.
--
-- Verified against production before writing: 0 duplicate and 0 empty phone or
-- civil ID values across 90 intakes and 87 drivers, so nothing needs a backfill
-- and the indexes below build cleanly.

-- Defensive: production has none today, but an empty string would violate the
-- CHECK added next, and a failed migration is worse than a normalised row.
UPDATE public.driver_intakes
SET phone = NULL
WHERE phone IS NOT NULL AND btrim(phone) = '';

UPDATE public.driver_intakes
SET civil_id = NULL
WHERE civil_id IS NOT NULL AND btrim(civil_id) = '';

UPDATE public.drivers
SET civil_id = NULL
WHERE civil_id IS NOT NULL AND btrim(civil_id) = '';

ALTER TABLE public.driver_intakes ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.driver_intakes ALTER COLUMN civil_id DROP NOT NULL;

-- "Absent" must have exactly one representation, or the unique constraints
-- above stop meaning what they say.
ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_phone_not_blank;
ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_phone_not_blank
  CHECK (phone IS NULL OR btrim(phone) <> '');

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_civil_id_not_blank;
ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_civil_id_not_blank
  CHECK (civil_id IS NULL OR btrim(civil_id) <> '');

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_civil_id_not_blank;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_civil_id_not_blank
  CHECK (civil_id IS NULL OR btrim(civil_id) <> '');

-- Scoped to live intakes, matching `driver_intakes_employee_id_unique_active`
-- and the app's own `civilIdExists`, so archiving a driver releases their
-- civil ID for re-entry instead of reserving it forever.
CREATE UNIQUE INDEX IF NOT EXISTS driver_intakes_civil_id_unique_active
  ON public.driver_intakes (civil_id)
  WHERE civil_id IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_civil_id_unique
  ON public.drivers (civil_id)
  WHERE civil_id IS NOT NULL;

COMMENT ON CONSTRAINT driver_intakes_phone_not_blank ON public.driver_intakes IS
  'Absent phone is NULL, never ''''. Empty strings would collide on driver_intakes_phone_unique.';

-- Approve must accept a driver who has neither, or the field would be optional
-- at creation and mandatory the moment anyone tried to activate the record.
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
  'Approve a driver intake. Requires full name + employee ID; phone and civil ID are optional but must be unique when present.';
