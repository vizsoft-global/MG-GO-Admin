-- Attendance auto-checkout: reason column, assigned-zone timer, midnight-safe
-- open-log checkout, and service RPC for cron.

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS check_out_reason text;

ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_check_out_reason_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_check_out_reason_check
  CHECK (
    check_out_reason IS NULL
    OR check_out_reason IN ('manual', 'auto_offline', 'auto_out_of_zone', 'admin')
  );

COMMENT ON COLUMN public.attendance_logs.check_out_reason IS
  'How check-out was recorded: manual duty off, auto_offline, auto_out_of_zone, or admin correction.';

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS out_of_zone_since timestamptz;

COMMENT ON COLUMN public.driver_locations.out_of_zone_since IS
  'Continuous out-of-assigned-zone start; cleared when back in zone. Used for auto-checkout.';

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS attendance_auto_checkout_minutes integer NOT NULL DEFAULT 45;

COMMENT ON COLUMN public.app_settings.attendance_auto_checkout_minutes IS
  'Continuous offline or out-of-assigned-zone minutes before system auto-checkout.';

-- ---------------------------------------------------------------------------
-- BEFORE trigger: maintain out_of_zone_since from assigned zone geometry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._driver_locations_assigned_zone_timer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_zone_id uuid;
  v_zone public.zones%ROWTYPE;
  v_inside boolean := true;
BEGIN
  SELECT d.zone_id INTO v_zone_id FROM public.drivers d WHERE d.id = NEW.driver_id;

  IF v_zone_id IS NULL THEN
    NEW.out_of_zone_since := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_zone FROM public.zones z WHERE z.id = v_zone_id;
  IF NOT FOUND OR v_zone.geometry IS NULL THEN
    NEW.out_of_zone_since := NULL;
    RETURN NEW;
  END IF;

  v_inside := public._point_within_zone_proximity(
    NEW.latitude::double precision,
    NEW.longitude::double precision,
    v_zone.geometry,
    v_zone.zone_type,
    0
  );

  IF v_inside THEN
    NEW.out_of_zone_since := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.out_of_zone_since IS NOT NULL THEN
    NEW.out_of_zone_since := OLD.out_of_zone_since;
  ELSE
    NEW.out_of_zone_since := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_locations_assigned_zone_timer ON public.driver_locations;
CREATE TRIGGER trg_driver_locations_assigned_zone_timer
  BEFORE INSERT OR UPDATE OF latitude, longitude, zone_status
  ON public.driver_locations
  FOR EACH ROW
  EXECUTE FUNCTION public._driver_locations_assigned_zone_timer();

-- ---------------------------------------------------------------------------
-- Shared apply checkout helper (manual / auto / admin path callers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._attendance_apply_checkout(
  p_driver_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now(),
  p_distance_meters numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log_id uuid;
  v_open_session_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'manual', 'auto_offline', 'auto_out_of_zone', 'admin'
  ) THEN
    RAISE EXCEPTION 'invalid_check_out_reason';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = false,
      updated_at = p_now
  WHERE id = p_driver_id
    AND is_on_duty = true;

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
        went_offline_at = COALESCE(went_offline_at, p_now),
        updated_at = p_now
    WHERE id = v_open_session_id;
  END IF;

  UPDATE public.attendance_logs
  SET check_out_at = p_now,
      check_out_reason = p_reason,
      distance_meters = COALESCE(p_distance_meters, distance_meters),
      updated_at = p_now
  WHERE id = (
    SELECT al.id
    FROM public.attendance_logs al
    WHERE al.driver_id = p_driver_id
      AND al.check_in_at IS NOT NULL
      AND al.check_out_at IS NULL
    ORDER BY al.check_in_at DESC
    LIMIT 1
  )
  RETURNING id INTO v_log_id;

  DELETE FROM public.driver_locations WHERE driver_id = p_driver_id;

  RETURN v_log_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- driver_set_duty_state: open-log checkout + check_out_reason = manual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_set_duty_state(p_is_on_duty boolean, p_is_online boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_open_session_id uuid;
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_distance_today numeric(12, 2) := 0;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_active_shift public.driver_daily_shifts;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_is_on_duty OR p_is_online THEN
    v_active_shift := public._driver_find_active_shift(v_driver_id, v_now);
    IF v_active_shift IS NULL OR v_active_shift.id IS NULL THEN
      RAISE EXCEPTION 'shift_required';
    END IF;
  END IF;

  UPDATE public.drivers
  SET is_on_duty = p_is_on_duty,
      updated_at = v_now
  WHERE id = v_driver_id;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  SELECT COALESCE(dl.distance_today_meters, 0)
  INTO v_distance_today
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_driver_id;

  IF p_is_on_duty THEN
    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status, check_out_reason)
    VALUES (v_driver_id, v_log_date, v_now, 'present', NULL)
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          check_out_at = NULL,
          check_out_reason = NULL,
          status = CASE
            WHEN attendance_logs.status = 'on_leave' THEN attendance_logs.status
            ELSE 'present'
          END,
          updated_at = v_now;
  END IF;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, v_now);
    ELSE
      UPDATE public.driver_sessions
      SET is_online = true,
          went_offline_at = NULL,
          updated_at = v_now
      WHERE id = v_open_session_id;
    END IF;

    INSERT INTO public.driver_attendance (
      driver_id,
      attendance_date,
      first_online_at,
      last_online_at,
      status
    )
    VALUES (v_driver_id, v_log_date, v_now, v_now, 'online_unvalidated')
    ON CONFLICT (driver_id, attendance_date) DO UPDATE
      SET first_online_at = COALESCE(driver_attendance.first_online_at, EXCLUDED.first_online_at),
          last_online_at = v_now,
          status = CASE
            WHEN driver_attendance.status = 'present' THEN 'present'
            ELSE 'online_unvalidated'
          END,
          updated_at = v_now;
  ELSIF v_open_session_id IS NOT NULL THEN
    UPDATE public.driver_sessions
    SET is_online = false,
        went_offline_at = v_now,
        updated_at = v_now
    WHERE id = v_open_session_id;

    SELECT GREATEST(
      0,
      extract(epoch FROM (
        v_now - COALESCE(da.last_online_at, da.first_online_at, v_now)
      ))::integer
    )
    INTO v_elapsed
    FROM public.driver_attendance da
    WHERE da.driver_id = v_driver_id
      AND da.attendance_date = v_log_date;

    UPDATE public.driver_attendance
    SET online_seconds = online_seconds + COALESCE(v_elapsed, 0),
        last_online_at = v_now,
        status = CASE
          WHEN status = 'present' THEN 'present'
          ELSE 'online_unvalidated'
        END,
        updated_at = v_now
    WHERE driver_id = v_driver_id
      AND attendance_date = v_log_date
      AND first_online_at IS NOT NULL;
  END IF;

  IF NOT p_is_on_duty THEN
    PERFORM public._attendance_apply_checkout(
      v_driver_id,
      'manual',
      v_now,
      v_distance_today
    );
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$function$;

COMMENT ON FUNCTION public.driver_set_duty_state(boolean, boolean) IS
  'Driver app: toggle on-duty and online. Checkout uses open attendance log (midnight-safe) with check_out_reason=manual.';

-- ---------------------------------------------------------------------------
-- admin_correct_attendance: stamp check_out_reason = admin when checkout set
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_correct_attendance(
  p_log_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_log_date date DEFAULT NULL,
  p_check_in_at timestamptz DEFAULT NULL,
  p_check_out_at timestamptz DEFAULT NULL,
  p_status public.attendance_status DEFAULT 'present',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.attendance_logs%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_reason text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  v_reason := CASE WHEN p_check_out_at IS NOT NULL THEN 'admin' ELSE NULL END;

  IF p_log_id IS NOT NULL THEN
    SELECT *
    INTO v_row
    FROM public.attendance_logs
    WHERE id = p_log_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'log_not_found';
    END IF;

    IF v_row.log_date > v_today THEN
      RAISE EXCEPTION 'future_date';
    END IF;

    IF p_check_in_at IS NOT NULL AND p_check_out_at IS NOT NULL
       AND p_check_out_at < p_check_in_at THEN
      RAISE EXCEPTION 'invalid_times';
    END IF;

    UPDATE public.attendance_logs
    SET check_in_at = COALESCE(p_check_in_at, check_in_at),
        check_out_at = p_check_out_at,
        check_out_reason = CASE
          WHEN p_check_out_at IS NULL THEN NULL
          ELSE COALESCE(v_reason, check_out_reason, 'admin')
        END,
        status = COALESCE(p_status, status),
        admin_note = btrim(p_note),
        updated_at = now()
    WHERE id = p_log_id
    RETURNING * INTO v_row;
  ELSE
    IF p_driver_id IS NULL OR p_log_date IS NULL THEN
      RAISE EXCEPTION 'missing_fields';
    END IF;

    IF p_log_date > v_today THEN
      RAISE EXCEPTION 'future_date';
    END IF;

    IF p_check_in_at IS NOT NULL AND p_check_out_at IS NOT NULL
       AND p_check_out_at < p_check_in_at THEN
      RAISE EXCEPTION 'invalid_times';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id
    ) THEN
      RAISE EXCEPTION 'driver_not_found';
    END IF;

    INSERT INTO public.attendance_logs (
      driver_id,
      log_date,
      check_in_at,
      check_out_at,
      check_out_reason,
      status,
      admin_note
    )
    VALUES (
      p_driver_id,
      p_log_date,
      p_check_in_at,
      p_check_out_at,
      v_reason,
      COALESCE(p_status, 'present'),
      btrim(p_note)
    )
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(EXCLUDED.check_in_at, attendance_logs.check_in_at),
          check_out_at = EXCLUDED.check_out_at,
          check_out_reason = CASE
            WHEN EXCLUDED.check_out_at IS NULL THEN NULL
            ELSE COALESCE(EXCLUDED.check_out_reason, 'admin')
          END,
          status = EXCLUDED.status,
          admin_note = EXCLUDED.admin_note,
          updated_at = now()
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- Cron RPC: auto-checkout after continuous offline OR out-of-zone threshold
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_run_attendance_auto_checkout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_run_attendance_auto_checkout() TO service_role;

-- ---------------------------------------------------------------------------
-- Expose check_out_reason on daily reporting view
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_attendance_exceptions CASCADE;
DROP VIEW IF EXISTS public.v_live_operations CASCADE;
DROP VIEW IF EXISTS public.v_attendance_daily CASCADE;

CREATE OR REPLACE VIEW public.v_attendance_daily AS
WITH settings AS (
  SELECT
    COALESCE(attendance_late_grace_minutes, 10) AS late_grace,
    COALESCE(attendance_early_out_grace_minutes, 5) AS early_grace,
    COALESCE(attendance_gps_stale_minutes, 10) AS gps_stale,
    COALESCE(attendance_gps_min_accuracy_meters, 100) AS gps_accuracy
  FROM public.app_settings
  WHERE id = 1
),
driver_days AS (
  SELECT al.driver_id, al.log_date AS attendance_date
  FROM public.attendance_logs al
  UNION
  SELECT ds.driver_id, ds.shift_date
  FROM public.driver_daily_shifts ds
  UNION
  SELECT da.driver_id, da.attendance_date
  FROM public.driver_attendance da
),
shift_window AS (
  SELECT
    ds.driver_id,
    ds.shift_date AS attendance_date,
    ds.shift_type,
    public.shift_session_instant(ds.shift_date, ds.session1_start, 0) AS scheduled_start_at,
    CASE
      WHEN ds.shift_type = 'split' AND ds.session2_end IS NOT NULL THEN
        public.shift_session_instant(
          ds.shift_date,
          ds.session2_end,
          COALESCE(ds.session2_end_day_offset, 0)
        )
      ELSE
        public.shift_session_instant(
          ds.shift_date,
          ds.session1_end,
          ds.session1_end_day_offset
        )
    END AS scheduled_end_at
  FROM public.driver_daily_shifts ds
),
online_sessions AS (
  SELECT
    dd.driver_id,
    dd.attendance_date,
    COALESCE(
      SUM(
        EXTRACT(
          EPOCH FROM (
            COALESCE(sess.went_offline_at, now()) - sess.went_online_at
          )
        )
      )::integer,
      0
    ) AS session_online_seconds
  FROM driver_days dd
  INNER JOIN public.driver_sessions sess ON sess.driver_id = dd.driver_id
  WHERE (sess.went_online_at AT TIME ZONE 'Asia/Kuwait')::date = dd.attendance_date
  GROUP BY dd.driver_id, dd.attendance_date
)
SELECT
  dd.driver_id,
  dd.attendance_date AS log_date,
  d.driver_code,
  d.employee_id,
  p.full_name AS driver_name,
  p.phone AS driver_phone,
  d.partner_id,
  pt.name AS partner_name,
  d.zone_id,
  z.name AS zone_name,
  d.is_on_duty AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date AS is_on_duty,
  sw.shift_type,
  sw.scheduled_start_at,
  sw.scheduled_end_at,
  al.id AS attendance_log_id,
  al.check_in_at,
  al.check_out_at,
  al.check_out_reason,
  CASE
    WHEN al.status = 'on_leave' THEN 'on_leave'
    WHEN d.is_on_duty AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date THEN 'present'
    WHEN al.check_in_at IS NOT NULL THEN 'present'
    WHEN sw.scheduled_start_at IS NOT NULL THEN 'absent'
    ELSE 'absent'
  END AS attendance_status,
  COALESCE(da.online_seconds, os.session_online_seconds, 0) AS online_seconds,
  GREATEST(
    0,
    EXTRACT(
      EPOCH FROM (
        COALESCE(
          al.check_out_at,
          CASE
            WHEN d.is_on_duty AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
              THEN now()
            ELSE NULL
          END
        ) - al.check_in_at
      )
    )::integer
  ) AS duty_seconds,
  GREATEST(
    0,
    CASE
      WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN
        (EXTRACT(EPOCH FROM (al.check_in_at - sw.scheduled_start_at)) / 60)::integer
        - (SELECT late_grace FROM settings)
      ELSE 0
    END
  ) AS minutes_late,
  GREATEST(
    0,
    CASE
      WHEN al.check_out_at IS NOT NULL AND sw.scheduled_end_at IS NOT NULL THEN
        (EXTRACT(EPOCH FROM (sw.scheduled_end_at - al.check_out_at)) / 60)::integer
        - (SELECT early_grace FROM settings)
      ELSE 0
    END
  ) AS minutes_early_out,
  dl.last_seen_at,
  dl.zone_status AS gps_zone_status,
  dl.accuracy_meters AS gps_accuracy_meters,
  dl.is_mocked AS gps_is_mocked,
  CASE
    WHEN sw.scheduled_start_at IS NULL THEN 'no_shift'
    WHEN al.check_in_at IS NULL
      AND NOT (d.is_on_duty AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date)
      THEN 'absent'
    WHEN GREATEST(
      0,
      CASE
        WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN
          (EXTRACT(EPOCH FROM (al.check_in_at - sw.scheduled_start_at)) / 60)::integer
          - (SELECT late_grace FROM settings)
        ELSE 0
      END
    ) > 0 THEN 'late'
    WHEN d.is_on_duty
      AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
      AND NOT EXISTS (
        SELECT 1 FROM public.driver_sessions s
        WHERE s.driver_id = d.id AND s.is_online = true
      ) THEN 'offline_during_shift'
    WHEN d.is_on_duty
      AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
      AND dl.last_seen_at IS NOT NULL
      AND dl.last_seen_at < now() - ((SELECT gps_stale FROM settings) || ' minutes')::interval
      THEN 'gps_stale'
    WHEN dl.zone_status = 'out_of_zone' THEN 'outside_zone'
    WHEN al.check_out_at IS NOT NULL THEN 'completed'
    WHEN d.is_on_duty AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait')::date THEN 'on_duty'
    WHEN al.check_in_at IS NOT NULL THEN 'present'
    ELSE 'scheduled'
  END AS live_status,
  CASE
    WHEN al.check_in_at IS NULL OR sw.scheduled_start_at IS NULL THEN NULL
    WHEN GREATEST(
      0,
      (EXTRACT(EPOCH FROM (al.check_in_at - sw.scheduled_start_at)) / 60)::integer
        - (SELECT late_grace FROM settings)
    ) > 0 THEN 70
    WHEN GREATEST(
      0,
      EXTRACT(
        EPOCH FROM (
          COALESCE(al.check_out_at, now()) - al.check_in_at
        )
      )::integer
    ) > 0 THEN LEAST(
      100,
      ROUND(
        (COALESCE(da.online_seconds, os.session_online_seconds, 0)::numeric
          / NULLIF(
              EXTRACT(
                EPOCH FROM (
                  COALESCE(al.check_out_at, now()) - al.check_in_at
                )
              ),
              0
            )
        ) * 100
      )::integer
    )
    ELSE 100
  END AS compliance_score
FROM driver_days dd
INNER JOIN public.drivers d ON d.id = dd.driver_id
INNER JOIN public.profiles p ON p.id = d.id
LEFT JOIN public.partners pt ON pt.id = d.partner_id
LEFT JOIN public.zones z ON z.id = d.zone_id
LEFT JOIN shift_window sw
  ON sw.driver_id = dd.driver_id AND sw.attendance_date = dd.attendance_date
LEFT JOIN public.attendance_logs al
  ON al.driver_id = dd.driver_id AND al.log_date = dd.attendance_date
LEFT JOIN public.driver_attendance da
  ON da.driver_id = dd.driver_id AND da.attendance_date = dd.attendance_date
LEFT JOIN online_sessions os
  ON os.driver_id = dd.driver_id AND os.attendance_date = dd.attendance_date
LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
WHERE d.archived_at IS NULL;

CREATE OR REPLACE VIEW public.v_live_operations AS
SELECT v.*
FROM public.v_attendance_daily v
WHERE v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
  AND (
    v.scheduled_start_at IS NOT NULL
    OR v.is_on_duty
  );

CREATE OR REPLACE VIEW public.v_attendance_exceptions AS
SELECT
  md5(v.driver_id::text || ':' || v.log_date::text || ':' || ex.exception_type) AS exception_key,
  v.driver_id,
  v.log_date AS exception_date,
  ex.exception_type,
  ex.severity,
  ex.detected_at,
  ex.duration_seconds,
  v.driver_name,
  v.driver_code,
  v.employee_id,
  v.partner_name,
  v.zone_name,
  v.live_status AS current_status,
  a.resolution_status,
  a.action AS supervisor_action,
  a.note AS supervisor_note,
  a.supervisor_id
FROM public.v_attendance_daily v
CROSS JOIN LATERAL (
  SELECT *
  FROM (
    VALUES
      (
        'LateCheckIn'::text,
        CASE WHEN v.minutes_late > 0 THEN 'high' ELSE NULL END,
        v.check_in_at,
        (v.minutes_late * 60)
      ),
      (
        'NoCheckIn'::text,
        CASE
          WHEN v.scheduled_start_at IS NOT NULL
            AND v.check_in_at IS NULL
            AND NOT v.is_on_duty
            AND v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
            AND now() > v.scheduled_start_at
          THEN 'high'
          ELSE NULL
        END,
        v.scheduled_start_at,
        GREATEST(0, EXTRACT(EPOCH FROM (now() - v.scheduled_start_at))::integer)
      ),
      (
        'EarlyLogout'::text,
        CASE WHEN v.minutes_early_out > 0 THEN 'medium' ELSE NULL END,
        v.check_out_at,
        (v.minutes_early_out * 60)
      ),
      (
        'OfflineDuringShift'::text,
        CASE WHEN v.live_status = 'offline_during_shift' THEN 'high' ELSE NULL END,
        v.last_seen_at,
        NULL::integer
      ),
      (
        'OutsideZone'::text,
        CASE WHEN v.live_status = 'outside_zone' THEN 'medium' ELSE NULL END,
        v.last_seen_at,
        NULL::integer
      ),
      (
        'MissingLocationUpdates'::text,
        CASE WHEN v.live_status = 'gps_stale' THEN 'high' ELSE NULL END,
        v.last_seen_at,
        NULL::integer
      ),
      (
        'NoAssignedShift'::text,
        CASE
          WHEN v.scheduled_start_at IS NULL
            AND v.check_in_at IS NOT NULL
            AND v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date
          THEN 'low'
          ELSE NULL
        END,
        v.check_in_at,
        NULL::integer
      )
  ) AS t(exception_type, severity, detected_at, duration_seconds)
  WHERE t.severity IS NOT NULL
) ex
LEFT JOIN public.attendance_exception_actions a
  ON a.exception_key = md5(v.driver_id::text || ':' || v.log_date::text || ':' || ex.exception_type);

GRANT SELECT ON public.v_attendance_daily TO authenticated;
GRANT SELECT ON public.v_live_operations TO authenticated;
GRANT SELECT ON public.v_attendance_exceptions TO authenticated;
