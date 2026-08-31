-- Activation needs a zone or a published restaurant, not both, and not neither.
--
-- Restaurant-only fleets keep working: a published mapping is still a complete
-- assignment. Zone-only fleets can now be approved and set Active without
-- inventing a restaurant they do not use. Clearing the last of the two still
-- drops an active driver back to pending, same as losing the last restaurant
-- used to.

CREATE OR REPLACE FUNCTION public.driver_has_ops_assignment(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drivers d
    WHERE d.id = p_driver_id
      AND (
        d.zone_id IS NOT NULL
        OR public.driver_has_active_restaurant(p_driver_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.intake_has_ops_assignment(p_intake_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_intakes i
    WHERE i.id = p_intake_id
      AND (
        i.zone_id IS NOT NULL
        OR public.intake_has_active_restaurant(p_intake_id)
      )
  );
$$;

COMMENT ON FUNCTION public.driver_has_ops_assignment(uuid) IS
  'True when the driver has a zone or at least one published active restaurant.';

COMMENT ON FUNCTION public.intake_has_ops_assignment(uuid) IS
  'True when the intake has a zone or at least one active restaurant mapping.';

CREATE OR REPLACE FUNCTION public.enforce_driver_active_restaurant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- BEFORE INSERT cannot see the new row; use NEW.zone_id, not the table lookup.
  IF NEW.status = 'active'::public.driver_status
     AND (OLD.status IS DISTINCT FROM NEW.status OR TG_OP = 'INSERT')
     AND NEW.zone_id IS NULL
     AND NOT public.driver_has_active_restaurant(NEW.id) THEN
    RAISE EXCEPTION 'driver_missing_assignment';
  END IF;
  RETURN NEW;
END;
$$;

-- Losing the last restaurant must not demote a zone-only driver.
CREATE OR REPLACE FUNCTION public.sync_driver_status_after_restaurant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  v_driver_id := COALESCE(NEW.driver_id, OLD.driver_id);

  IF v_driver_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_driver_id
      AND d.status = 'active'::public.driver_status
      AND NOT public.driver_has_ops_assignment(v_driver_id)
  ) THEN
    UPDATE public.drivers
    SET status = 'pending'::public.driver_status, updated_at = now()
    WHERE id = v_driver_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Clearing the zone on a restaurant-less active driver is the same event.
CREATE OR REPLACE FUNCTION public.sync_driver_status_after_zone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active'::public.driver_status
     AND NEW.zone_id IS NULL
     AND OLD.zone_id IS DISTINCT FROM NEW.zone_id
     AND NOT public.driver_has_active_restaurant(NEW.id) THEN
    NEW.status := 'pending'::public.driver_status;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_sync_status_on_zone ON public.drivers;
CREATE TRIGGER drivers_sync_status_on_zone
  BEFORE UPDATE OF zone_id ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_status_after_zone_change();

CREATE OR REPLACE FUNCTION public.set_driver_account_status(
  p_driver_id uuid,
  p_status public.driver_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_status = 'active'::public.driver_status
     AND NOT public.driver_has_ops_assignment(p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_assignment');
  END IF;

  UPDATE public.drivers
  SET status = p_status, updated_at = now()
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_status IS DISTINCT FROM 'active'::public.driver_status THEN
    PERFORM public._end_driver_duty_keep_gps(p_driver_id, 'admin');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status);
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
SET search_path TO 'public'
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

  IF v_intake.full_name IS NULL OR trim(v_intake.full_name) = ''
     OR v_intake.employee_id IS NULL OR trim(v_intake.employee_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF NOT public.intake_has_ops_assignment(p_intake_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_assignment');
  END IF;

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
  'Approve a driver intake. Requires a zone or an active restaurant mapping, then copies the intake onto the driver row.';

REVOKE ALL ON FUNCTION public.driver_has_ops_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intake_has_ops_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_has_ops_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intake_has_ops_assignment(uuid) TO authenticated;
