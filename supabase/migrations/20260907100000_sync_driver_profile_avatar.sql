-- Bidirectional driver profile photo: app writes drivers.avatar_object_key,
-- admin reads profiles.avatar_url / driver_intakes.avatar_url. Keep them in lockstep.

CREATE OR REPLACE FUNCTION public.driver_update_avatar(
  p_object_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_object_key, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid) THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_key IS NOT NULL THEN
    IF v_key LIKE '%..%' THEN
      RAISE EXCEPTION 'invalid_object_key';
    END IF;
    IF NOT (
      v_key LIKE ('driver-avatars/' || v_uid::text || '/%')
      OR v_key ~* ('^drivers/' || v_uid::text || '/avatar\.[a-z0-9]+$')
    ) THEN
      RAISE EXCEPTION 'invalid_object_key';
    END IF;
  END IF;

  UPDATE public.drivers
  SET avatar_object_key = v_key,
      avatar_updated_at = now(),
      updated_at = now()
  WHERE id = v_uid;

  UPDATE public.profiles
  SET avatar_url = v_key,
      updated_at = now()
  WHERE id = v_uid;

  UPDATE public.driver_intakes
  SET avatar_url = v_key,
      updated_at = now()
  WHERE linked_profile_id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'avatar_object_key', v_key,
    'avatar_updated_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.driver_update_avatar(text) IS
  'Rider: set profile photo object key on drivers, profiles, and linked intake so admin and app stay in sync.';

-- Copy intake photo onto profile + driver row on Verify & approve.
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
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
END;
$$;

-- Fill whichever side is still empty so existing mismatched rows start agreeing.
UPDATE public.profiles p
SET avatar_url = d.avatar_object_key,
    updated_at = now()
FROM public.drivers d
WHERE p.id = d.id
  AND d.avatar_object_key IS NOT NULL
  AND btrim(d.avatar_object_key) <> ''
  AND (p.avatar_url IS NULL OR btrim(p.avatar_url) = '');

UPDATE public.drivers d
SET avatar_object_key = p.avatar_url,
    avatar_updated_at = COALESCE(d.avatar_updated_at, now()),
    updated_at = now()
FROM public.profiles p
WHERE d.id = p.id
  AND (d.avatar_object_key IS NULL OR btrim(d.avatar_object_key) = '')
  AND p.avatar_url IS NOT NULL
  AND btrim(p.avatar_url) <> '';

UPDATE public.driver_intakes i
SET avatar_url = d.avatar_object_key,
    updated_at = now()
FROM public.drivers d
WHERE i.linked_profile_id = d.id
  AND d.avatar_object_key IS NOT NULL
  AND btrim(d.avatar_object_key) <> ''
  AND (i.avatar_url IS NULL OR btrim(i.avatar_url) = '');
