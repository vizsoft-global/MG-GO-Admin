-- Emit driver_operation_events from the notification, profile, app-version and
-- security RPCs. Signatures unchanged.
--
-- driver_log_security_event mirrors driver_security_events into the unified
-- stream. That table has a writer but no admin UI, so until now every security
-- signal the app raised was invisible.
--
-- The notification RPCs log only when they actually changed something. The app
-- calls them on every inbox open, so an unconditional emit would fill the feed
-- with rows saying nothing happened.

CREATE OR REPLACE FUNCTION public.driver_mark_notifications_read(
  p_dispatch_item_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  WITH updated AS (
    UPDATE public.notification_dispatch_items i
    SET
      opened_at = COALESCE(i.opened_at, v_now),
      status = CASE
        WHEN i.opened_at IS NULL THEN 'opened'::public.notification_dispatch_item_status
        ELSE i.status
      END,
      updated_at = v_now
    WHERE i.driver_id = v_uid
      AND i.opened_at IS NULL
      AND (p_dispatch_item_ids IS NULL OR i.id = ANY (p_dispatch_item_ids))
    RETURNING i.id, i.campaign_id
  ),
  events_inserted AS (
    INSERT INTO public.notification_events (
      campaign_id,
      dispatch_item_id,
      driver_id,
      event_type,
      provider,
      occurred_at,
      metadata
    )
    SELECT
      u.campaign_id,
      u.id,
      v_uid,
      'opened'::public.notification_event_type,
      'fcm',
      v_now,
      jsonb_build_object('source', 'inbox')
    FROM updated u
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM updated;

  IF v_updated > 0 THEN
    PERFORM public.log_driver_operation(
      v_uid, 'notification', 'notification.read', 'rpc', 'driver_mark_notifications_read',
      true, NULL, 'notification', NULL,
      jsonb_build_object(
        'count', v_updated,
        'scope', CASE WHEN p_dispatch_item_ids IS NULL THEN 'all' ELSE 'selected' END
      )
    );
  END IF;

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_dismiss_notifications(
  p_dispatch_item_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.notification_dispatch_items i
  SET
    dismissed_at = v_now,
    updated_at = v_now
  WHERE i.driver_id = v_uid
    AND i.dismissed_at IS NULL
    AND (p_dispatch_item_ids IS NULL OR i.id = ANY (p_dispatch_item_ids));

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    PERFORM public.log_driver_operation(
      v_uid, 'notification', 'notification.dismiss', 'rpc', 'driver_dismiss_notifications',
      true, NULL, 'notification', NULL,
      jsonb_build_object(
        'count', v_updated,
        'scope', CASE WHEN p_dispatch_item_ids IS NULL THEN 'all' ELSE 'selected' END
      )
    );
  END IF;

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_update_avatar(p_object_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Path traversal attempt. Rare, security-relevant, and it RAISEs, so it
      -- needs the autonomous emitter to survive at all.
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'security', 'security.avatar_key_rejected', 'driver_update_avatar',
        'invalid_object_key',
        jsonb_build_object('reason', 'path_traversal')
      );
      RAISE EXCEPTION 'invalid_object_key';
    END IF;
    IF NOT (
      v_key LIKE ('driver-avatars/' || v_uid::text || '/%')
      OR v_key ~* ('^drivers/' || v_uid::text || '/avatar\.[a-z0-9]+$')
    ) THEN
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'security', 'security.avatar_key_rejected', 'driver_update_avatar',
        'invalid_object_key',
        jsonb_build_object('reason', 'outside_own_prefix')
      );
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

  PERFORM public.log_driver_operation(
    v_uid, 'profile', 'profile.avatar', 'rpc', 'driver_update_avatar',
    true, NULL, 'driver', v_uid,
    jsonb_build_object('cleared', v_key IS NULL)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'avatar_object_key', v_key,
    'avatar_updated_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_record_app_version(
  p_platform text DEFAULT 'android'::text,
  p_channel text DEFAULT 'production'::text,
  p_version_name text DEFAULT NULL::text,
  p_version_code integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_prev_code integer;
  v_channel constant text := 'production';
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_rider() THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF p_platform IS DISTINCT FROM 'android' THEN
    RAISE EXCEPTION 'unsupported_platform';
  END IF;

  IF p_version_code IS NULL OR p_version_code <= 0 THEN
    RETURN;
  END IF;

  SELECT d.current_app_version_code
  INTO v_prev_code
  FROM public.drivers d
  WHERE d.id = v_driver_id;

  UPDATE public.drivers
  SET
    current_app_platform = p_platform,
    current_app_channel = v_channel,
    current_app_version_name = NULLIF(btrim(p_version_name), ''),
    current_app_version_code = p_version_code,
    app_version_seen_at = now(),
    updated_at = now()
  WHERE id = v_driver_id;

  -- Same condition as the history insert: only a real change is an event. This
  -- RPC fires on every app start.
  IF v_prev_code IS DISTINCT FROM p_version_code THEN
    INSERT INTO public.driver_app_version_history (
      driver_id,
      platform,
      channel,
      version_name,
      version_code
    )
    VALUES (
      v_driver_id,
      p_platform,
      v_channel,
      NULLIF(btrim(p_version_name), ''),
      p_version_code
    );

    PERFORM public.log_driver_operation(
      v_driver_id, 'profile', 'app.version_change', 'rpc', 'driver_record_app_version',
      true, NULL, 'driver', v_driver_id,
      jsonb_build_object(
        'from_version_code', v_prev_code,
        'to_version_code', p_version_code,
        'version_name', NULLIF(btrim(p_version_name), '')
      )
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_log_security_event(
  p_event_type text,
  p_severity text DEFAULT 'warning'::text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_severity text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_event_type IS NULL OR trim(p_event_type) = '' THEN
    RAISE EXCEPTION 'event_type_required';
  END IF;

  v_severity := lower(coalesce(nullif(trim(p_severity), ''), 'warning'));
  IF v_severity NOT IN ('low', 'medium', 'high', 'warning') THEN
    RAISE EXCEPTION 'invalid_severity';
  END IF;

  INSERT INTO public.driver_security_events (driver_id, event_type, severity, context)
  VALUES (v_uid, trim(p_event_type), v_severity, coalesce(p_context, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM public.log_driver_operation(
    v_uid, 'security', 'security.' || trim(p_event_type), 'rpc', 'driver_log_security_event',
    true, NULL, 'security_event', v_id,
    jsonb_build_object('severity', v_severity) || coalesce(p_context, '{}'::jsonb)
  );

  RETURN v_id;
END;
$function$;
