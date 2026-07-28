-- Single-device session enforcement for driver app.
-- Each driver may have only one active device at a time. Kicked devices get a
-- short flush grace window to push offline-queued deliveries before sign-out.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS active_device_id text,
  ADD COLUMN IF NOT EXISTS active_device_session_id uuid;

CREATE INDEX IF NOT EXISTS drivers_active_device_id_idx
  ON public.drivers (active_device_id)
  WHERE active_device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.driver_device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_model text,
  device_manufacturer text,
  os_version text,
  android_sdk_int integer,
  app_version_name text,
  app_version_code integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN ('override', 'manual_signout', 'admin_forced', 'flushed')
  ),
  flush_deadline_at timestamptz,
  flushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_device_sessions_driver_device_unique UNIQUE (driver_id, device_id)
);

CREATE INDEX IF NOT EXISTS driver_device_sessions_driver_last_seen_idx
  ON public.driver_device_sessions (driver_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS driver_device_sessions_active_idx
  ON public.driver_device_sessions (driver_id, device_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.driver_device_sessions IS
  'Per-device login history and active session tracking for driver app single-device enforcement.';

ALTER TABLE public.driver_device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_device_sessions_driver_select ON public.driver_device_sessions;
CREATE POLICY driver_device_sessions_driver_select ON public.driver_device_sessions
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_device_sessions_admin_select ON public.driver_device_sessions;
CREATE POLICY driver_device_sessions_admin_select ON public.driver_device_sessions
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_device_sessions_admin_update ON public.driver_device_sessions;
CREATE POLICY driver_device_sessions_admin_update ON public.driver_device_sessions
  FOR UPDATE TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._driver_assert_device_match(
  p_uid uuid,
  p_device_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active text;
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_grace boolean := false;
BEGIN
  SELECT d.active_device_id
  INTO v_active
  FROM public.drivers d
  WHERE d.id = p_uid;

  IF v_active IS NULL OR v_active = '' THEN
    RETURN true;
  END IF;

  IF v_norm IS NULL THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  IF v_active = v_norm THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.driver_device_sessions s
    WHERE s.driver_id = p_uid
      AND s.device_id = v_norm
      AND s.revoked_reason = 'override'
      AND s.flushed_at IS NULL
      AND s.flush_deadline_at IS NOT NULL
      AND now() < s.flush_deadline_at
  ) INTO v_grace;

  IF v_grace THEN
    RETURN true;
  END IF;

  RAISE EXCEPTION 'device_revoked';
END;
$function$;

-- ---------------------------------------------------------------------------
-- Driver RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_heartbeat(
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  RETURN jsonb_build_object(
    'ok', v_grace,
    'kicked', true,
    'flush_grace_active', v_grace,
    'flush_deadline_at', v_deadline,
    'active_device', v_active_device
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_finalize_reconciliation(
  p_device_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := NULLIF(btrim(p_device_id), '');
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_release_device_session(
  p_device_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := NULLIF(btrim(p_device_id), '');
  v_active text;
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
    UPDATE public.drivers d
    SET active_device_id = NULL,
        active_device_session_id = NULL,
        updated_at = now()
    WHERE d.id = v_uid;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_driver_device_overview(
  p_driver_id uuid,
  p_history_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active jsonb := NULL;
  v_history jsonb := '[]'::jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_history_limit, 20), 1), 100);
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id_required';
  END IF;

  SELECT jsonb_build_object(
    'session_id', s.id,
    'device_id', s.device_id,
    'device_model', s.device_model,
    'device_manufacturer', s.device_manufacturer,
    'os_version', s.os_version,
    'android_sdk_int', s.android_sdk_int,
    'app_version_name', s.app_version_name,
    'app_version_code', s.app_version_code,
    'first_seen_at', s.first_seen_at,
    'last_seen_at', s.last_seen_at,
    'revoked_at', s.revoked_at,
    'revoked_reason', s.revoked_reason,
    'flush_deadline_at', s.flush_deadline_at,
    'flushed_at', s.flushed_at,
    'is_active', (d.active_device_id = s.device_id)
  )
  INTO v_active
  FROM public.drivers d
  LEFT JOIN public.driver_device_sessions s
    ON s.id = d.active_device_session_id
  WHERE d.id = p_driver_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'session_id', row.id,
        'device_id', row.device_id,
        'device_model', row.device_model,
        'device_manufacturer', row.device_manufacturer,
        'os_version', row.os_version,
        'android_sdk_int', row.android_sdk_int,
        'app_version_name', row.app_version_name,
        'app_version_code', row.app_version_code,
        'first_seen_at', row.first_seen_at,
        'last_seen_at', row.last_seen_at,
        'revoked_at', row.revoked_at,
        'revoked_reason', row.revoked_reason,
        'flush_deadline_at', row.flush_deadline_at,
        'flushed_at', row.flushed_at,
        'is_active', (row.device_id = d.active_device_id)
      )
      ORDER BY row.last_seen_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM (
    SELECT s.*
    FROM public.driver_device_sessions s
    WHERE s.driver_id = p_driver_id
    ORDER BY s.last_seen_at DESC
    LIMIT v_limit
  ) row
  CROSS JOIN public.drivers d
  WHERE d.id = p_driver_id;

  RETURN jsonb_build_object(
    'driver_id', p_driver_id,
    'active_device_id', (SELECT active_device_id FROM public.drivers WHERE id = p_driver_id),
    'active_device', v_active,
    'history', v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_force_sign_out_driver(
  p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id_required';
  END IF;

  SELECT d.active_device_id
  INTO v_active
  FROM public.drivers d
  WHERE d.id = p_driver_id;

  IF v_active IS NOT NULL THEN
    UPDATE public.driver_device_sessions s
    SET revoked_at = now(),
        revoked_reason = 'admin_forced',
        updated_at = now()
    WHERE s.driver_id = p_driver_id
      AND s.device_id = v_active
      AND s.revoked_at IS NULL;
  END IF;

  UPDATE public.drivers d
  SET active_device_id = NULL,
      active_device_session_id = NULL,
      updated_at = now()
  WHERE d.id = p_driver_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Delivery RPCs — add p_device_id guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL::text,
  p_order_proof_url text DEFAULT NULL::text,
  p_pickup_lat numeric DEFAULT NULL::numeric,
  p_pickup_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_norm text;
  v_order_id text;
  v_proximity integer;
  v_active uuid;
  v_restaurant_id uuid;
  v_matched_count integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_dup boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_driver := public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  SELECT d.id INTO v_active
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status = 'in_transit'::public.delivery_status
  LIMIT 1;

  IF v_active IS NOT NULL THEN
    RAISE EXCEPTION 'active_pickup_exists';
  END IF;

  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NOT NULL AND v_norm <> '' THEN
    v_order_id := trim(both '#' from trim(p_external_order_id));
  ELSE
    v_order_id := NULL;
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity > 0
     AND NOT public.driver_is_within_delivery_range(
       v_uid,
       p_pickup_lat::double precision,
       p_pickup_lng::double precision,
       v_proximity
     ) THEN
    RAISE EXCEPTION 'delivery_out_of_range';
  END IF;

  v_restaurant_id := NULL;

  IF v_driver.partner_id IS NOT NULL THEN
    SELECT
      COUNT(*)::integer,
      (array_agg(dr.restaurant_id))[1]
    INTO v_matched_count, v_restaurant_id
    FROM public.driver_restaurants dr
    INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = v_uid
      AND r.partner_id = v_driver.partner_id
      AND r.status = 'published'
      AND r.is_active = true;

    IF v_matched_count IS DISTINCT FROM 1 THEN
      v_restaurant_id := NULL;
    END IF;
  END IF;

  IF v_norm IS NOT NULL
     AND v_norm <> ''
     AND v_restaurant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.deliveries d
      WHERE d.restaurant_id = v_restaurant_id
        AND d.status <> 'cancelled'::public.delivery_status
        AND public.normalize_external_order_id(d.external_order_id) = v_norm
        AND (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date = v_today
    ) INTO v_dup;

    IF v_dup THEN
      RAISE EXCEPTION 'duplicate_order_id';
    END IF;
  END IF;

  INSERT INTO public.deliveries (
    driver_id,
    partner_id,
    zone_id,
    restaurant_id,
    external_order_id,
    pickup_proof_url,
    status,
    pickup_at,
    pickup_lat,
    pickup_lng
  ) VALUES (
    v_uid,
    v_driver.partner_id,
    v_driver.zone_id,
    v_restaurant_id,
    v_order_id,
    NULLIF(trim(p_order_proof_url), ''),
    'in_transit'::public.delivery_status,
    now(),
    p_pickup_lat,
    p_pickup_lng
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_complete_delivery(
  p_delivery_id uuid,
  p_delivery_proof_url text DEFAULT NULL::text,
  p_delivered_lat numeric DEFAULT NULL::numeric,
  p_delivered_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET order_proof_url = NULLIF(trim(p_delivery_proof_url), ''),
      delivered_at = now(),
      delivered_lat = p_delivered_lat,
      delivered_lng = p_delivered_lng,
      status = 'pending'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_cancel_delivery(
  p_delivery_id uuid,
  p_cancel_reason text DEFAULT NULL::text,
  p_cancel_proof_url text DEFAULT NULL::text,
  p_cancel_lat numeric DEFAULT NULL::numeric,
  p_cancel_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  v_reason := NULLIF(trim(p_cancel_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'cancel_reason_required';
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET cancel_reason = v_reason,
      cancel_proof_url = NULLIF(trim(p_cancel_proof_url), ''),
      cancelled_at = now(),
      cancel_lat = p_cancel_lat,
      cancel_lng = p_cancel_lng,
      status = 'cancelled'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.driver_heartbeat(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_finalize_reconciliation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_release_device_session(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_driver_device_overview(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_sign_out_driver(uuid) TO authenticated;
