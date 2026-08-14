-- Five paths that change a driver's duty state, or remove them from the map,
-- while writing no event at all.
--
-- This is why a driver can vanish from Live Tracking with nothing in the stream
-- explaining it: the operation audit only ever hears from the driver app, so an
-- admin block, an automatic checkout, an inactive-status trigger, a stale-pickup
-- sweep and a cleared pin are all invisible. Live Tracking V2's event feed is only
-- as good as its inputs, so they are fixed before the feed is built.
--
-- Each change is additive: the existing behaviour is preserved byte for byte and a
-- log_driver_operation call is added alongside it.

-- ---------------------------------------------------------------------------
-- 1. Attendance auto-checkout — duty.auto_checkout, carrying the reason
--    (auto_offline / auto_out_of_zone) that attendance_logs already records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_run_attendance_auto_checkout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_minutes integer;
  v_cutoff timestamptz;
  v_count integer := 0;
  r record;
  v_reason text;
  v_offline_at timestamptz;
BEGIN
  SELECT COALESCE(attendance_auto_checkout_minutes, 45)
  INTO v_minutes
  FROM public.app_settings
  WHERE id = 1;

  v_minutes := GREATEST(COALESCE(v_minutes, 45), 1);
  v_cutoff := v_now - make_interval(mins => v_minutes);

  FOR r IN
    SELECT
      d.id AS driver_id,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      dl.latitude,
      dl.longitude,
      (
        SELECT ds.went_offline_at
        FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id
          AND ds.is_online = false
          AND ds.went_offline_at IS NOT NULL
        ORDER BY ds.went_offline_at DESC
        LIMIT 1
      ) AS went_offline_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions s
        WHERE s.driver_id = d.id AND s.is_online = true
      ) AS is_online_now
    FROM public.drivers d
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    WHERE d.is_on_duty = true
      AND d.archived_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.attendance_logs al
        WHERE al.driver_id = d.id
          AND al.check_in_at IS NOT NULL
          AND al.check_out_at IS NULL
      )
  LOOP
    v_reason := NULL;
    v_offline_at := CASE WHEN r.is_online_now THEN NULL ELSE r.went_offline_at END;

    IF v_offline_at IS NOT NULL AND v_offline_at <= v_cutoff THEN
      v_reason := 'auto_offline';
    ELSIF r.out_of_zone_since IS NOT NULL AND r.out_of_zone_since <= v_cutoff THEN
      v_reason := 'auto_out_of_zone';
    END IF;

    IF v_reason IS NOT NULL THEN
      PERFORM public._attendance_apply_checkout(
        r.driver_id,
        v_reason,
        v_now,
        r.distance_today_meters
      );

      PERFORM public.log_driver_operation(
        r.driver_id, 'duty', 'duty.auto_checkout', 'cron',
        'admin_run_attendance_auto_checkout', true, NULL, NULL, NULL,
        jsonb_build_object(
          'reason', v_reason,
          'threshold_minutes', v_minutes,
          'offline_since', v_offline_at,
          'out_of_zone_since', r.out_of_zone_since
        ),
        r.latitude, r.longitude
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Admin block — duty.blocked_checkout. Unblocking is logged too, since a
--    driver reappearing on the map deserves the same explanation as vanishing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_driver_blocked(
  p_driver_id uuid,
  p_blocked boolean,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
  v_now timestamptz := now();
  v_open_session_id uuid;
  v_was_on_duty boolean;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT d.is_on_duty INTO v_was_on_duty
  FROM public.drivers d WHERE d.id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_blocked THEN
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL OR length(v_reason) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_block_reason');
    END IF;

    UPDATE public.drivers
    SET
      is_blocked = true,
      blocked_reason = v_reason,
      blocked_at = v_now,
      blocked_by = auth.uid(),
      is_on_duty = false,
      updated_at = v_now
    WHERE id = p_driver_id;

    SELECT ds.id
    INTO v_open_session_id
    FROM public.driver_sessions ds
    WHERE ds.driver_id = p_driver_id
      AND ds.is_online = true
    ORDER BY ds.created_at DESC
    LIMIT 1;

    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = COALESCE(went_offline_at, v_now),
          updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = v_now,
        check_out_reason = 'admin',
        updated_at = v_now
    WHERE id = (
      SELECT al.id
      FROM public.attendance_logs al
      WHERE al.driver_id = p_driver_id
        AND al.check_in_at IS NOT NULL
        AND al.check_out_at IS NULL
      ORDER BY al.check_in_at DESC
      LIMIT 1
    );

    PERFORM public.log_driver_operation(
      p_driver_id, 'duty', 'duty.blocked_checkout', 'admin',
      'set_driver_blocked', true, NULL, NULL, NULL,
      jsonb_build_object(
        'reason', v_reason,
        'was_on_duty', COALESCE(v_was_on_duty, false),
        'session_closed', v_open_session_id IS NOT NULL,
        'blocked_by', auth.uid()
      ),
      NULL, NULL
    );
  ELSE
    UPDATE public.drivers
    SET
      is_blocked = false,
      blocked_reason = NULL,
      blocked_at = NULL,
      blocked_by = NULL,
      updated_at = v_now
    WHERE id = p_driver_id;

    PERFORM public.log_driver_operation(
      p_driver_id, 'duty', 'duty.unblocked', 'admin',
      'set_driver_blocked', true, NULL, NULL, NULL,
      jsonb_build_object('unblocked_by', auth.uid()),
      NULL, NULL
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Inactive account status — duty.inactive_checkout.
--
-- Logged only when the driver was actually on duty: the trigger also fires for
-- status changes that end no shift, and a stream full of no-ops is worse than no
-- event at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drivers_end_duty_on_inactive_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_was_on_duty boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_was_on_duty := COALESCE(OLD.is_on_duty, false);
  END IF;

  PERFORM public._end_driver_duty_keep_gps(NEW.id, 'admin');

  IF v_was_on_duty THEN
    PERFORM public.log_driver_operation(
      NEW.id, 'duty', 'duty.inactive_checkout', 'trigger',
      'drivers_end_duty_on_inactive_status', true, NULL, NULL, NULL,
      jsonb_build_object(
        'status_before', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END,
        'status_after', NEW.status::text
      ),
      NULL, NULL
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Stale pickup sweep — delivery.auto_cancel, one event per delivery.
--
-- The sweep already exists because a stuck in_transit pickup blocks the driver
-- from logging any further order; without an event the driver's own timeline
-- shows the pickup opening and then nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_expire_stale_pickups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hours integer;
  v_cutoff timestamptz;
  v_count integer := 0;
  r record;
BEGIN
  SELECT COALESCE(pickup_auto_cancel_hours, 6)
  INTO v_hours
  FROM public.app_settings
  WHERE id = 1;

  v_hours := GREATEST(COALESCE(v_hours, 6), 1);
  v_cutoff := now() - make_interval(hours => v_hours);

  FOR r IN
    WITH expired AS (
      UPDATE public.deliveries
      SET status = 'cancelled'::public.delivery_status,
          cancelled_at = now(),
          cancel_reason = COALESCE(
            cancel_reason,
            'Auto-cancelled: pickup not completed within ' || v_hours || 'h'
          )
      WHERE status = 'in_transit'::public.delivery_status
        AND COALESCE(pickup_at, created_at) <= v_cutoff
      RETURNING id, driver_id, external_order_id, pickup_at, created_at
    )
    SELECT * FROM expired
  LOOP
    v_count := v_count + 1;

    IF r.driver_id IS NOT NULL THEN
      PERFORM public.log_driver_operation(
        r.driver_id, 'delivery', 'delivery.auto_cancel', 'cron',
        'admin_expire_stale_pickups', true, NULL, 'delivery', r.id,
        jsonb_build_object(
          'order_id', r.external_order_id,
          'threshold_hours', v_hours,
          'opened_at', COALESCE(r.pickup_at, r.created_at)
        ),
        NULL, NULL
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Cleared live location — location.cleared.
--
-- This is the OS-location-off path: the pin is deleted so the rider leaves the
-- list rather than sitting there as a stale Idle. Without an event, that removal
-- is indistinguishable from a crash. search_path is '' here, so every reference
-- stays fully qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_clear_live_location()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_on_duty boolean;
  v_deleted integer;
  v_lat numeric;
  v_lng numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT d.is_on_duty
  INTO v_on_duty
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  -- Late FGS ticks after clock-out must not erase the Offline last-known pin.
  IF NOT v_on_duty THEN
    RETURN jsonb_build_object('cleared', false, 'reason', 'off_duty');
  END IF;

  -- Read the last position before deleting it: the event is far more useful with
  -- the place the driver disappeared from.
  SELECT dl.latitude, dl.longitude
  INTO v_lat, v_lng
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_uid;

  DELETE FROM public.driver_locations
  WHERE driver_id = v_uid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    PERFORM public.log_driver_operation(
      v_uid, 'location', 'location.cleared', 'rpc',
      'driver_clear_live_location', true, NULL, NULL, NULL,
      jsonb_build_object('basis', 'os_location_off'),
      v_lat, v_lng
    );
  END IF;

  RETURN jsonb_build_object('cleared', v_deleted > 0);
END;
$function$;
