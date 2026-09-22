-- Scheduled freeze, separate from is_blocked. Login reuses driver_blocked so
-- installed APKs still show the reason. Window is Kuwait calendar inclusive.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS frozen_from date,
  ADD COLUMN IF NOT EXISTS frozen_until date,
  ADD COLUMN IF NOT EXISTS freeze_reason text,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_freeze_window_chk;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_freeze_window_chk
  CHECK (
    (frozen_from IS NULL AND frozen_until IS NULL)
    OR (frozen_from IS NOT NULL AND frozen_until IS NOT NULL AND frozen_until >= frozen_from)
  );

CREATE TABLE IF NOT EXISTS public.driver_restriction_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('block', 'freeze', 'both')),
  label_en text NOT NULL,
  label_ar text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.driver_restriction_reasons (kind, label_en, label_ar, sort_order)
SELECT v.kind, v.label_en, v.label_ar, v.sort_order
FROM (VALUES
  ('both', 'Policy violation', 'مخالفة السياسة', 10),
  ('both', 'Document pending', 'مستندات معلّقة', 20),
  ('both', 'Investigation', 'قيد التحقيق', 30),
  ('both', 'Leave', 'إجازة', 40)
) AS v(kind, label_en, label_ar, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.driver_restriction_reasons);

ALTER TABLE public.driver_restriction_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_select_restriction_reasons ON public.driver_restriction_reasons;
CREATE POLICY staff_select_restriction_reasons
  ON public.driver_restriction_reasons
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.driver_freeze_is_active(p_from date, p_until date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_from IS NOT NULL
    AND p_until IS NOT NULL
    AND (timezone('Asia/Kuwait', now()))::date BETWEEN p_from AND p_until;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_frozen(
  p_driver_id uuid,
  p_from date,
  p_until date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_today date := (timezone('Asia/Kuwait', now()))::date;
  v_was_on_duty boolean;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_from IS NULL OR p_until IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_freeze_window');
  END IF;
  IF p_until < p_from THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_freeze_window');
  END IF;
  IF p_until < v_today THEN
    RETURN jsonb_build_object('ok', false, 'error', 'freeze_ended');
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_freeze_reason');
  END IF;

  SELECT d.is_on_duty INTO v_was_on_duty
  FROM public.drivers d WHERE d.id = p_driver_id;

  UPDATE public.drivers
  SET
    frozen_from = p_from,
    frozen_until = p_until,
    freeze_reason = v_reason,
    frozen_at = now(),
    frozen_by = auth.uid(),
    updated_at = now()
  WHERE id = p_driver_id;

  IF public.driver_freeze_is_active(p_from, p_until) THEN
    PERFORM public._end_driver_duty_keep_gps(p_driver_id, 'admin');
    PERFORM public.log_driver_operation(
      p_driver_id, 'duty', 'duty.frozen_checkout', 'admin',
      'set_driver_frozen', true, NULL, NULL, NULL,
      jsonb_build_object(
        'reason', v_reason,
        'frozen_from', p_from,
        'frozen_until', p_until,
        'was_on_duty', COALESCE(v_was_on_duty, false)
      ),
      NULL, NULL
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_unfrozen(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  UPDATE public.drivers
  SET
    frozen_from = NULL,
    frozen_until = NULL,
    freeze_reason = NULL,
    frozen_at = NULL,
    frozen_by = NULL,
    updated_at = now()
  WHERE id = p_driver_id;

  PERFORM public.log_driver_operation(
    p_driver_id, 'duty', 'duty.unfrozen', 'admin',
    'set_driver_unfrozen', true, NULL, NULL, NULL,
    jsonb_build_object('unfrozen_by', auth.uid()),
    NULL, NULL
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_freeze_start_checkout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT d.id
    FROM public.drivers d
    WHERE d.is_on_duty = true
      AND d.archived_at IS NULL
      AND public.driver_freeze_is_active(d.frozen_from, d.frozen_until)
  LOOP
    PERFORM public._end_driver_duty_keep_gps(r.id, 'admin');
    PERFORM public.log_driver_operation(
      r.id, 'duty', 'duty.frozen_checkout', 'cron',
      'admin_run_freeze_start_checkout', true, NULL, NULL, NULL,
      jsonb_build_object('reason', 'freeze_window_started'),
      NULL, NULL
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.drivers_refuse_duty_while_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_on_duty
     AND public.driver_freeze_is_active(NEW.frozen_from, NEW.frozen_until) THEN
    RAISE EXCEPTION 'driver_blocked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_refuse_duty_while_frozen ON public.drivers;
CREATE TRIGGER drivers_refuse_duty_while_frozen
  BEFORE UPDATE OF is_on_duty ON public.drivers
  FOR EACH ROW
  WHEN (NEW.is_on_duty IS TRUE AND OLD.is_on_duty IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.drivers_refuse_duty_while_frozen();

CREATE OR REPLACE FUNCTION public._driver_assert_active_on_duty(p_uid uuid)
RETURNS public.drivers
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;
  IF v_driver.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'driver_archived';
  END IF;
  IF v_driver.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'driver_not_active';
  END IF;
  IF public.driver_freeze_is_active(v_driver.frozen_from, v_driver.frozen_until) THEN
    RAISE EXCEPTION 'driver_blocked';
  END IF;
  IF NOT v_driver.is_on_duty THEN
    RAISE EXCEPTION 'driver_off_duty';
  END IF;
  RETURN v_driver;
END;
$function$;

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
  v_freeze_reason text;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  v_code := btrim(p_driver_code);

  SELECT id, status, driver_code, archived_at, is_blocked, blocked_reason,
         frozen_from, frozen_until, freeze_reason
  INTO v_driver
  FROM public.drivers
  WHERE app_passcode = p_passcode
    AND (lower(employee_id) = lower(v_code) OR driver_code = v_code)
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    SELECT d.id INTO v_audit_id
    FROM public.drivers d
    WHERE lower(d.employee_id) = lower(v_code) OR d.driver_code = v_code
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

  IF public.driver_freeze_is_active(v_driver.frozen_from, v_driver.frozen_until) THEN
    v_freeze_reason := coalesce(nullif(btrim(v_driver.freeze_reason), ''), 'Account frozen')
      || ' (until ' || v_driver.frozen_until::text || ')';
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_blocked', 'driver', v_driver.id,
      jsonb_build_object('reason', v_freeze_reason, 'freeze', true)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'driver_blocked',
      'reason', v_freeze_reason
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

GRANT SELECT ON public.driver_restriction_reasons TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_freeze_is_active(date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_frozen(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_unfrozen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_freeze_start_checkout() TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_app_lookup_by_passcode(text, text) TO anon, authenticated;

ALTER TABLE public.driver_change_events
  DROP CONSTRAINT IF EXISTS driver_change_events_source_chk;
ALTER TABLE public.driver_change_events
  ADD CONSTRAINT driver_change_events_source_chk CHECK (
    source = ANY (ARRAY[
      'manual_create','bulk_import','edit','approve','archive','restore',
      'status','block','unblock','passcode','document','asset','assignment',
      'freeze','unfreeze'
    ])
  );

-- Active freeze paints as blocked on the V2 roster (same pin path). Latest body:
-- 20260924100100_vehicle_types.sql
CREATE OR REPLACE FUNCTION public.admin_live_fleet_snapshot(
  p_seen_within_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_cutoff timestamptz;
  v_drivers jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cutoff := v_now - make_interval(mins => GREATEST(COALESCE(p_seen_within_minutes, 30), 1));

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_seen_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_drivers
  FROM (
    SELECT
      d.id AS driver_id,
      COALESCE(NULLIF(trim(p.full_name), ''), d.driver_code) AS driver_name,
      d.driver_code,
      d.employee_id,
      d.avatar_object_key,
      d.avatar_updated_at,
      p.avatar_url,
      p.phone,
      d.status::text AS account_status,
      d.is_on_duty,
      (d.is_blocked OR public.driver_freeze_is_active(d.frozen_from, d.frozen_until)) AS is_blocked,
      d.zone_id,
      z.name AS zone_name,
      z.color AS zone_color,
      d.partner_id,
      pa.name AS partner_name,
      d.restaurant_id,
      r.name AS restaurant_name,
      d.vehicle_id,
      v.reg_number AS vehicle_reg_number,
      v.bike_id AS vehicle_bike_id,
      COALESCE(v.vehicle_type_key, d.vehicle_type_key, 'bike') AS vehicle_type_key,
      dl.latitude,
      dl.longitude,
      dl.speed_mps,
      dl.heading_deg,
      dl.accuracy_meters,
      dl.battery_pct,
      dl.is_mocked,
      dl.tracking_status,
      dl.zone_status,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      open_delivery.id AS active_delivery_id,
      dl.last_seen_at,
      dl.last_report_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id AND ds.is_online
      ) AS is_online,
      (
        SELECT al.check_in_at
        FROM public.attendance_logs al
        WHERE al.driver_id = d.id AND al.log_date = v_day
        ORDER BY al.check_in_at DESC NULLS LAST
        LIMIT 1
      ) AS on_duty_since,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.status <> 'cancelled'
          AND (dv.created_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_today,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.delivered_at IS NOT NULL
          AND (dv.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
      ) AS deliveries_completed_today,
      sh.shift
    FROM public.drivers d
    JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    LEFT JOIN public.partners pa ON pa.id = d.partner_id
    LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    LEFT JOIN LATERAL (
      SELECT dv.id
      FROM public.deliveries dv
      WHERE dv.driver_id = d.id
        AND dv.status = 'in_transit'
      ORDER BY dv.pickup_at DESC NULLS LAST, dv.created_at DESC
      LIMIT 1
    ) open_delivery ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'shift_date', s.shift_date,
        'shift_type', s.shift_type,
        'session1_start_at',
          ((s.shift_date + s.session1_start)::timestamp AT TIME ZONE 'Asia/Kuwait'),
        'session1_end_at',
          (((s.shift_date + COALESCE(s.session1_end_day_offset, 0)) + s.session1_end)::timestamp
            AT TIME ZONE 'Asia/Kuwait'),
        'session2_start_at',
          CASE WHEN s.session2_start IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_start_day_offset, 0)) + s.session2_start)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'session2_end_at',
          CASE WHEN s.session2_end IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_end_day_offset, 0)) + s.session2_end)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'submitted_at', s.submitted_at
      ) AS shift
      FROM public.driver_daily_shifts s
      WHERE s.driver_id = d.id AND s.shift_date = v_day
      LIMIT 1
    ) sh ON true
    WHERE d.archived_at IS NULL
      AND (
        d.is_on_duty
        OR d.is_blocked
        OR public.driver_freeze_is_active(d.frozen_from, d.frozen_until)
        OR dl.last_seen_at >= v_cutoff
        OR open_delivery.id IS NOT NULL
      )
  ) x;

  RETURN jsonb_build_object(
    'generated_at', v_now,
    'kuwait_day', v_day,
    'settings', public._fleet_settings(),
    'drivers', v_drivers
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_live_fleet_snapshot(integer) TO authenticated, service_role;
