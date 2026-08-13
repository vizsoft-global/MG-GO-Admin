-- Emit driver_operation_events from the auth and device RPCs.
-- Signatures are unchanged: installed Flutter builds keep working.
--
-- All four of these are Class A for the paths worth auditing - they RETURN
-- rather than RAISE - so the in-transaction emitter is correct and no dblink
-- loopback is involved.
--
-- driver_heartbeat deliberately logs ONLY the rejected path. The accepted path
-- runs every few seconds per online driver; logging it would bury every real
-- event in the feed.

-- ---------------------------------------------------------------------------
-- auth.passcode_lookup (including failed attempts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_app_lookup_by_passcode(p_driver_code text, p_passcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_driver record;
  v_code text;
  v_audit_id uuid;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  v_code := btrim(p_driver_code);

  SELECT id, status, driver_code, archived_at, is_blocked, blocked_reason
  INTO v_driver
  FROM public.drivers
  WHERE app_passcode = p_passcode
    AND (employee_id = v_code OR driver_code = v_code)
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    -- A wrong passcode against a real driver code is the signal worth having, so
    -- resolve the driver by code alone to attribute the attempt. An unknown code
    -- resolves to NULL and the emitter drops it - there is no driver to attribute
    -- it to, and driver_id is NOT NULL by design.
    SELECT d.id INTO v_audit_id
    FROM public.drivers d
    WHERE d.employee_id = v_code OR d.driver_code = v_code
    LIMIT 1;

    PERFORM public.log_driver_operation(
      v_audit_id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'invalid_credentials', 'driver', v_audit_id,
      jsonb_build_object('driver_code_tried', v_code)
    );

    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_driver.archived_at IS NOT NULL THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_archived', 'driver', v_driver.id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_archived');
  END IF;

  IF v_driver.is_blocked THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_blocked', 'driver', v_driver.id,
      jsonb_build_object('reason', nullif(btrim(v_driver.blocked_reason), ''))
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'driver_blocked',
      'reason', nullif(btrim(v_driver.blocked_reason), '')
    );
  END IF;

  IF v_driver.status = 'suspended'::public.driver_status THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_suspended', 'driver', v_driver.id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_suspended');
  END IF;

  IF v_driver.status <> 'active'::public.driver_status THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_not_active', 'driver', v_driver.id,
      jsonb_build_object('status', v_driver.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_active');
  END IF;

  PERFORM public.log_driver_operation(
    v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
    true, NULL, 'driver', v_driver.id, '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_driver.id,
    'driver_code', v_driver.driver_code
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- device.signout
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_release_device_session(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_active text;
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_distance_today numeric(12, 2) := 0;
  v_was_active boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF v_norm IS NULL THEN
    RETURN;
  END IF;

  SELECT d.active_device_id
  INTO v_active
  FROM public.drivers d
  WHERE d.id = v_uid;

  UPDATE public.driver_device_sessions s
  SET revoked_at = COALESCE(s.revoked_at, now()),
      revoked_reason = COALESCE(s.revoked_reason, 'manual_signout'),
      updated_at = now()
  WHERE s.driver_id = v_uid
    AND s.device_id = v_norm
    AND s.revoked_at IS NULL;

  IF v_active = v_norm THEN
    v_was_active := true;

    UPDATE public.drivers d
    SET active_device_id = NULL,
        active_device_session_id = NULL,
        updated_at = now()
    WHERE d.id = v_uid;

    SELECT COALESCE(dl.distance_today_meters, 0)
    INTO v_distance_today
    FROM public.driver_locations dl
    WHERE dl.driver_id = v_uid;

    SELECT ds.id
    INTO v_open_session_id
    FROM public.driver_sessions ds
    WHERE ds.driver_id = v_uid
      AND ds.is_online = true
    ORDER BY ds.created_at DESC
    LIMIT 1;

    IF v_open_session_id IS NOT NULL THEN
      SELECT GREATEST(
        0,
        extract(epoch FROM (
          v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)
        ))::integer
      )
      INTO v_elapsed
      FROM public.driver_attendance da
      WHERE da.driver_id = v_uid
        AND da.attendance_date = v_log_date;

      UPDATE public.driver_attendance
      SET online_seconds = online_seconds + COALESCE(v_elapsed, 0),
          last_online_at = v_now,
          updated_at = v_now
      WHERE driver_id = v_uid
        AND attendance_date = v_log_date
        AND first_online_at IS NOT NULL;
    END IF;

    PERFORM public._attendance_apply_checkout(
      v_uid,
      'manual',
      v_now,
      v_distance_today
    );
  END IF;

  -- clocked_out records whether this signout released the ACTIVE device, which
  -- is the branch that closes the session and attendance log.
  PERFORM public.log_driver_operation(
    v_uid, 'device', 'device.signout', 'rpc', 'driver_release_device_session',
    true, NULL, 'device', NULL,
    jsonb_build_object('device_id', v_norm, 'clocked_out', v_was_active)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- device.heartbeat_rejected (rejected path only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_heartbeat(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active text;
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_session public.driver_device_sessions%ROWTYPE;
  v_grace boolean := false;
  v_deadline timestamptz;
  v_active_device jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  SELECT d.active_device_id
  INTO v_active
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF v_active = v_norm THEN
    UPDATE public.driver_device_sessions s
    SET last_seen_at = now(),
        updated_at = now()
    WHERE s.driver_id = v_uid
      AND s.device_id = v_norm;

    -- Accepted heartbeat: intentionally NOT logged. This fires every few seconds
    -- per online driver and would drown the operations feed.
    RETURN jsonb_build_object(
      'ok', true,
      'kicked', false,
      'flush_grace_active', false,
      'flush_deadline_at', NULL,
      'active_device', NULL
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.driver_device_sessions s
  WHERE s.driver_id = v_uid
    AND s.device_id = v_norm
  ORDER BY s.last_seen_at DESC
  LIMIT 1;

  v_grace := v_session.revoked_reason = 'override'
    AND v_session.flushed_at IS NULL
    AND v_session.flush_deadline_at IS NOT NULL
    AND now() < v_session.flush_deadline_at;
  v_deadline := v_session.flush_deadline_at;

  IF v_active IS NOT NULL AND v_active <> '' THEN
    SELECT jsonb_build_object(
      'device_id', s.device_id,
      'device_model', s.device_model,
      'device_manufacturer', s.device_manufacturer,
      'last_seen_at', s.last_seen_at
    )
    INTO v_active_device
    FROM public.driver_device_sessions s
    WHERE s.driver_id = v_uid
      AND s.device_id = v_active
    LIMIT 1;
  END IF;

  -- Grace still counts as usable, so success tracks v_grace rather than being
  -- flatly false.
  PERFORM public.log_driver_operation(
    v_uid, 'device', 'device.heartbeat_rejected', 'rpc', 'driver_heartbeat',
    v_grace,
    CASE WHEN v_grace THEN 'device_override_grace' ELSE 'device_kicked' END,
    'device', NULL,
    jsonb_build_object(
      'device_id', v_norm,
      'active_device_id', v_active,
      'flush_deadline_at', v_deadline
    )
  );

  RETURN jsonb_build_object(
    'ok', v_grace,
    'kicked', true,
    'flush_grace_active', v_grace,
    'flush_deadline_at', v_deadline,
    'active_device', v_active_device
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- device.reconciliation_flushed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_finalize_reconciliation(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_flushed integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  UPDATE public.driver_device_sessions s
  SET flushed_at = now(),
      revoked_reason = 'flushed',
      updated_at = now()
  WHERE s.driver_id = v_uid
    AND s.device_id = v_norm
    AND s.revoked_reason = 'override'
    AND s.flushed_at IS NULL;

  GET DIAGNOSTICS v_flushed = ROW_COUNT;

  -- Only log a real flush. The app calls this defensively, so a zero-row call is
  -- a no-op, not an event.
  IF v_flushed > 0 THEN
    PERFORM public.log_driver_operation(
      v_uid, 'device', 'device.reconciliation_flushed', 'rpc', 'driver_finalize_reconciliation',
      true, NULL, 'device', NULL,
      jsonb_build_object('device_id', v_norm)
    );
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- auth.login_selfie
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_record_login_verification(
  p_object_key text,
  p_liveness_passed boolean DEFAULT false,
  p_liveness_method text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_object_key, '')), '');
  v_row public.driver_login_verifications%ROWTYPE;
  v_expected_prefix text;
  v_passed boolean := COALESCE(p_liveness_passed, false);
  v_method text := NULLIF(btrim(COALESCE(p_liveness_method, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid) THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'object_key_required';
  END IF;

  v_expected_prefix := 'drivers/' || v_uid::text || '/login_verification/';
  IF position(v_expected_prefix in v_key) <> 1 THEN
    RAISE EXCEPTION 'invalid_object_key';
  END IF;

  -- Phase 1: accept DEFAULT false / omitted args from old APKs. No hard RAISE.

  INSERT INTO public.driver_login_verifications (
    driver_id,
    object_key,
    captured_at,
    liveness_passed,
    liveness_method
  )
  VALUES (v_uid, v_key, now(), v_passed, v_method)
  RETURNING * INTO v_row;

  PERFORM public.log_driver_operation(
    v_uid, 'auth', 'auth.login_selfie', 'rpc', 'driver_record_login_verification',
    true, NULL, 'login_verification', v_row.id,
    jsonb_build_object('liveness_passed', v_passed, 'liveness_method', v_method)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'object_key', v_row.object_key,
    'captured_at', v_row.captured_at,
    'created_at', v_row.created_at,
    'liveness_passed', v_row.liveness_passed,
    'liveness_method', v_row.liveness_method
  );
END;
$function$;
