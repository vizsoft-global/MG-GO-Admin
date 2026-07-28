-- Exception workflow (admin-owned) + reporting views + paginated list RPCs.

CREATE TABLE IF NOT EXISTS public.attendance_exception_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_key text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  exception_type text NOT NULL,
  exception_date date NOT NULL,
  supervisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text,
  resolution_status text NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open', 'acknowledged', 'resolved')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_exception_actions_driver_date
  ON public.attendance_exception_actions (driver_id, exception_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_exception_actions_status
  ON public.attendance_exception_actions (resolution_status, exception_date DESC);

ALTER TABLE public.attendance_exception_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_exception_actions_staff_all ON public.attendance_exception_actions;
CREATE POLICY attendance_exception_actions_staff_all
  ON public.attendance_exception_actions
  FOR ALL
  TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- ---------------------------------------------------------------------------
-- Daily attendance row (driver × date)
-- ---------------------------------------------------------------------------
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

-- Upsert exception action
CREATE OR REPLACE FUNCTION public.admin_upsert_exception_action(
  p_exception_key text,
  p_driver_id uuid,
  p_exception_type text,
  p_exception_date date,
  p_resolution_status text,
  p_action text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.attendance_exception_actions%ROWTYPE;
  v_supervisor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.attendance_exception_actions (
    exception_key,
    driver_id,
    exception_type,
    exception_date,
    supervisor_id,
    action,
    resolution_status,
    note
  )
  VALUES (
    p_exception_key,
    p_driver_id,
    p_exception_type,
    p_exception_date,
    v_supervisor,
    NULLIF(btrim(p_action), ''),
    COALESCE(NULLIF(btrim(p_resolution_status), ''), 'open'),
    NULLIF(btrim(p_note), '')
  )
  ON CONFLICT (exception_key) DO UPDATE SET
    resolution_status = EXCLUDED.resolution_status,
    action = COALESCE(EXCLUDED.action, attendance_exception_actions.action),
    note = COALESCE(EXCLUDED.note, attendance_exception_actions.note),
    supervisor_id = v_supervisor,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'exception_key', v_row.exception_key,
    'resolution_status', v_row.resolution_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_exception_action(text, uuid, text, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_exception_action(text, uuid, text, date, text, text, text) TO authenticated;

-- Paginated list
CREATE OR REPLACE FUNCTION public.admin_list_attendance_daily(
  p_from date,
  p_to date,
  p_search text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_live_only boolean DEFAULT false,
  p_sort text DEFAULT 'problems_first',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_total integer;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH filtered AS (
    SELECT v.*
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
      AND (NOT p_live_only OR v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date)
      AND (p_partner_id IS NULL OR v.partner_id = p_partner_id)
      AND (p_zone_id IS NULL OR v.zone_id = p_zone_id)
      AND (
        p_restaurant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.driver_restaurants dr
          WHERE dr.driver_id = v.driver_id AND dr.restaurant_id = p_restaurant_id
        )
      )
      AND (
        p_status IS NULL
        OR p_status = 'all'
        OR (p_status = 'scheduled' AND v.live_status = 'scheduled')
        OR (p_status = 'checked_in' AND v.check_in_at IS NOT NULL)
        OR (p_status = 'late' AND v.minutes_late > 0)
        OR (p_status = 'absent' AND v.live_status = 'absent')
        OR (p_status = 'online' AND v.is_on_duty AND v.live_status = 'on_duty')
        OR (p_status = 'problems' AND v.live_status IN (
          'late', 'absent', 'offline_during_shift', 'gps_stale', 'outside_zone'
        ))
        OR v.live_status = p_status
      )
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR v.driver_name ILIKE '%' || btrim(p_search) || '%'
        OR v.driver_code ILIKE '%' || btrim(p_search) || '%'
        OR v.employee_id ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::integer AS total FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered f
    ORDER BY
      CASE p_sort
        WHEN 'problems_first' THEN
          CASE f.live_status
            WHEN 'late' THEN 1
            WHEN 'offline_during_shift' THEN 2
            WHEN 'gps_stale' THEN 3
            WHEN 'outside_zone' THEN 4
            WHEN 'absent' THEN 5
            ELSE 10
          END
        WHEN 'name_asc' THEN 0
        WHEN 'name_desc' THEN 0
        WHEN 'last_seen' THEN 0
        WHEN 'date_asc' THEN 0
        ELSE 0
      END,
      CASE WHEN p_sort IN ('problems_first', 'date_desc') THEN f.log_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'date_asc' THEN f.log_date END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_asc' THEN f.driver_name END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_desc' THEN f.driver_name END DESC NULLS LAST,
      CASE WHEN p_sort = 'last_seen' THEN f.last_seen_at END DESC NULLS LAST,
      f.driver_name ASC
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  INTO v_total, v_rows
  FROM paged p;

  RETURN jsonb_build_object(
    'totalCount', COALESCE(v_total, 0),
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_attendance_daily(date, date, text, uuid, uuid, uuid, text, boolean, text, integer, integer) TO authenticated;

-- KPI aggregates
CREATE OR REPLACE FUNCTION public.admin_attendance_kpis(
  p_date date,
  p_partner_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scheduled integer;
  v_checked_in integer;
  v_late integer;
  v_absent integer;
  v_online integer;
  v_problems integer;
  v_compliance numeric;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE v.scheduled_start_at IS NOT NULL),
    COUNT(*) FILTER (WHERE v.check_in_at IS NOT NULL OR v.is_on_duty),
    COUNT(*) FILTER (WHERE v.minutes_late > 0),
    COUNT(*) FILTER (WHERE v.live_status = 'absent'),
    COUNT(*) FILTER (WHERE v.is_on_duty AND v.live_status IN ('on_duty', 'offline_during_shift')),
    COUNT(*) FILTER (WHERE v.live_status IN (
      'late', 'absent', 'offline_during_shift', 'gps_stale', 'outside_zone'
    )),
    ROUND(AVG(v.compliance_score) FILTER (WHERE v.compliance_score IS NOT NULL))
  INTO v_scheduled, v_checked_in, v_late, v_absent, v_online, v_problems, v_compliance
  FROM public.v_attendance_daily v
  WHERE v.log_date = p_date
    AND (p_partner_id IS NULL OR v.partner_id = p_partner_id)
    AND (p_zone_id IS NULL OR v.zone_id = p_zone_id)
    AND (
      p_restaurant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.driver_restaurants dr
        WHERE dr.driver_id = v.driver_id AND dr.restaurant_id = p_restaurant_id
      )
    );

  RETURN jsonb_build_object(
    'scheduled', COALESCE(v_scheduled, 0),
    'checked_in', COALESCE(v_checked_in, 0),
    'late', COALESCE(v_late, 0),
    'absent', COALESCE(v_absent, 0),
    'online', COALESCE(v_online, 0),
    'problems', COALESCE(v_problems, 0),
    'compliance_score', COALESCE(v_compliance, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_attendance_kpis(date, uuid, uuid, uuid) TO authenticated;

-- Paginated exceptions
CREATE OR REPLACE FUNCTION public.admin_list_attendance_exceptions(
  p_date date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_unresolved_only boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_total integer;
  v_day date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kuwait')::date);
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH filtered AS (
    SELECT e.*
    FROM public.v_attendance_exceptions e
    WHERE e.exception_date = v_day
      AND (NOT p_unresolved_only OR COALESCE(e.resolution_status, 'open') <> 'resolved')
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR e.driver_name ILIKE '%' || btrim(p_search) || '%'
        OR e.driver_code ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  counted AS (SELECT COUNT(*)::integer AS total FROM filtered),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      detected_at DESC NULLS LAST
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT (SELECT total FROM counted), COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  INTO v_total, v_rows
  FROM paged p;

  RETURN jsonb_build_object(
    'totalCount', COALESCE(v_total, 0),
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_attendance_exceptions(date, text, boolean, integer, integer) TO authenticated;
