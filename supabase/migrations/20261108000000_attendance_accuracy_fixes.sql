-- 20261108000000_attendance_accuracy_fixes.sql
--
-- QA #12 / #18 / #19 — three reports that all reduce to what the attendance
-- view and its two read RPCs decide, so they are fixed in one place.
--
-- #12 — correcting a day to "On leave" changed `attendance_logs.status` but the
--   list kept painting the old chip, because the row renders `live_status` and
--   that CASE never mentioned `al.status`. The view's *other* status column
--   (`attendance_status`) already had the `on_leave` branch, which is why the
--   Performance and payroll rolls read leave days correctly while the operator
--   looking at the same row did not. `live_status` now yields `on_leave` first —
--   before `no_shift`, because a rider on approved leave usually has no shift
--   row and the day would otherwise be filed as "No shift". The app gets
--   `liveOnLeave` (en + ar) and the two client sort tables learn the value, so
--   the status filter and the A–Z sort work on it too.
--
-- #18 — the Partner filter asked `v.partner_id = p_partner_id`, i.e.
--   `drivers.partner_id`, which only 7 of 888 live riders carry, so filtering
--   by a partner returned an empty table for almost every pick. Two things had
--   to change, and the first is the one that actually makes the report go away.
--
--   `project_key` is this product's partner, in those words: the Performance
--   SOP calls it Partner and the ops slicer filters on it. Measured on the day
--   of writing: `project_key` is `keeta` for 159 riders and `americana` for
--   606, while `partners.slug` is `keeta` for the partner named Keeta. The view
--   now resolves a rider's partner as `drivers.partner_id`, falling back to the
--   partner whose `slug` equals the rider's `project_key` — so "Keeta" returns
--   its 159 riders instead of none, and the Partner column / "Group by partner"
--   stop printing an em dash for every one of them.
--
--   The second change is additive: both the list RPC and the KPI RPC also match
--   a rider through the restaurants they are assigned to
--   (`driver_restaurants → restaurants.partner_id`), which is how a partner
--   link will arrive once the restaurant↔partner directory is populated
--   (2 of 132 restaurants carry one today, none of them assigned). Both RPCs
--   move together, because a KPI tile that disagreed with the table under it
--   would be worse than the bug.
--
-- #19 — "Offline during shift" matched `NOT EXISTS (driver_sessions.is_online)`,
--   and `is_online` only flips false on an explicit clock-out or device
--   release, never on GPS silence. Production on the day this was written:
--   0 `offline_during_shift` against 12 `gps_stale` — the riders an operator was
--   looking for sat under a chip that was not even in the filter dropdown.
--   GPS silence (no fix, or the last fix older than
--   `attendance_gps_stale_minutes`) now also produces `offline_during_shift`,
--   and the separate `gps_stale` branch is folded into it.
--
--   Two deliberate divergences from the previous bodies, both required for the
--   new status to mean anything:
--     * the list's `p_status='online'` filter and the KPI's `online` count were
--       `is_on_duty AND live_status IN ('on_duty','offline_during_shift')` —
--       an IN written when the second value could never occur. Both are now
--       `live_status = 'on_duty'`, which is the "Online = GPS-live" definition
--       the 2026-08-13 changelog states. Keeping the IN would have jumped the
--       tile 2 → 14 on the same day the honest status appeared.
--     * `gps_stale` is no longer produced by the view. It stays named in the
--       `problems` IN-list and in `LIVE_STATUS_LABEL_KEYS` so nothing that
--       still reads it breaks, but no row carries it.
--
-- SCOPE: one view + two read-only RPCs, all already gated on
-- `is_admin_panel_user()`. No table, column, RLS policy, grant, route or
-- permission is touched. `security_invoker` is re-asserted on the view.
--
-- MEASURED on eoksxkdssptgyqyywdju the day of writing, today's Kuwait window,
-- before the change: no_shift 240, completed 22, outside_zone 15, gps_stale 12,
-- on_duty 2, late 1, offline_during_shift 0. The view body was diffed against
-- `pg_get_viewdef` and the two RPC bodies against `pg_get_functiondef` so only
-- the branches named above move; the partner predicate is the sole other edit
-- and is purely additive (the direct `drivers.partner_id` match is kept).

CREATE OR REPLACE VIEW public.v_attendance_daily AS
 WITH settings AS (
         SELECT COALESCE(s.attendance_late_grace_minutes, 10) AS late_grace,
            COALESCE(s.attendance_early_out_grace_minutes, 5) AS early_grace,
            COALESCE(s.attendance_gps_stale_minutes, 10) AS gps_stale,
            COALESCE(s.attendance_gps_min_accuracy_meters, 100) AS gps_accuracy
           FROM app_settings s
          WHERE s.id = 1
        ), driver_days AS (
         SELECT al.driver_id,
            al.log_date AS attendance_date
           FROM attendance_logs al
        UNION
         SELECT ds.driver_id,
            ds.shift_date
           FROM driver_daily_shifts ds
        UNION
         SELECT da.driver_id,
            da.attendance_date
           FROM driver_attendance da
        ), shift_window AS (
         SELECT ds.driver_id,
            ds.shift_date AS attendance_date,
            ds.shift_type,
            shift_session_instant(ds.shift_date, ds.session1_start, 0) AS scheduled_start_at,
                CASE
                    WHEN ds.shift_type = 'split'::text AND ds.session2_end IS NOT NULL THEN shift_session_instant(ds.shift_date, ds.session2_end, COALESCE(ds.session2_end_day_offset::integer, 0))
                    ELSE shift_session_instant(ds.shift_date, ds.session1_end, ds.session1_end_day_offset::integer)
                END AS scheduled_end_at
           FROM driver_daily_shifts ds
        ), online_sessions AS (
         SELECT sess.driver_id,
            (sess.went_online_at AT TIME ZONE 'Asia/Kuwait'::text)::date AS attendance_date,
            COALESCE(sum(EXTRACT(epoch FROM COALESCE(sess.went_offline_at, now()) - sess.went_online_at))::integer, 0) AS session_online_seconds
           FROM driver_sessions sess
          GROUP BY sess.driver_id, (sess.went_online_at AT TIME ZONE 'Asia/Kuwait'::text)::date
        )
 SELECT dd.driver_id,
    dd.attendance_date AS log_date,
    d.driver_code,
    d.employee_id,
    p.full_name AS driver_name,
    p.phone AS driver_phone,
    COALESCE(pt.id, pts.id) AS partner_id,
    COALESCE(pt.name, pts.name) AS partner_name,
    d.zone_id,
    z.name AS zone_name,
    d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date AS is_on_duty,
    sw.shift_type,
    sw.scheduled_start_at,
    sw.scheduled_end_at,
    al.id AS attendance_log_id,
    al.check_in_at,
    al.check_out_at,
    al.check_out_reason,
        CASE
            WHEN al.status = 'on_leave'::attendance_status THEN 'on_leave'::text
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN 'present'::text
            WHEN al.check_in_at IS NOT NULL THEN 'present'::text
            WHEN sw.scheduled_start_at IS NOT NULL THEN 'absent'::text
            ELSE 'absent'::text
        END AS attendance_status,
    COALESCE(da.online_seconds, os.session_online_seconds, 0) AS online_seconds,
    GREATEST(0, EXTRACT(epoch FROM COALESCE(al.check_out_at,
        CASE
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN now()
            ELSE NULL::timestamp with time zone
        END) - al.check_in_at)::integer) AS duty_seconds,
    GREATEST(0,
        CASE
            WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
               FROM settings))
            ELSE 0
        END) AS minutes_late,
    LEAST(GREATEST(0,
        CASE
            WHEN al.check_out_at IS NOT NULL AND sw.scheduled_end_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM sw.scheduled_end_at - GREATEST(al.check_out_at, sw.scheduled_start_at)) / 60::numeric)::integer - (( SELECT settings.early_grace
               FROM settings))
            ELSE 0
        END), GREATEST(0, COALESCE((EXTRACT(epoch FROM sw.scheduled_end_at - sw.scheduled_start_at) / 60::numeric)::integer, 0))) AS minutes_early_out,
    dl.last_seen_at,
    dl.zone_status AS gps_zone_status,
    dl.accuracy_meters AS gps_accuracy_meters,
    dl.is_mocked AS gps_is_mocked,
        CASE
            WHEN al.status = 'on_leave'::attendance_status THEN 'on_leave'::text
            WHEN sw.scheduled_start_at IS NULL THEN 'no_shift'::text
            WHEN al.check_in_at IS NULL THEN 'absent'::text
            WHEN GREATEST(0,
            CASE
                WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
                   FROM settings))
                ELSE 0
            END) > 0 THEN 'late'::text
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date
                 AND (
                   NOT (EXISTS ( SELECT 1
                       FROM driver_sessions s
                      WHERE s.driver_id = d.id AND s.is_online = true))
                   OR dl.last_seen_at IS NULL
                   OR dl.last_seen_at < (now() - (((( SELECT settings.gps_stale
                       FROM settings)) || ' minutes'::text)::interval))
                 ) THEN 'offline_during_shift'::text
            WHEN dl.zone_status = 'out_of_zone'::text THEN 'outside_zone'::text
            WHEN al.check_out_at IS NOT NULL THEN 'completed'::text
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date THEN 'on_duty'::text
            WHEN al.check_in_at IS NOT NULL THEN 'present'::text
            ELSE 'scheduled'::text
        END AS live_status,
        CASE
            WHEN al.check_in_at IS NULL OR sw.scheduled_start_at IS NULL THEN NULL::integer
            WHEN GREATEST(0, (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
               FROM settings))) > 0 THEN 70
            WHEN GREATEST(0, EXTRACT(epoch FROM COALESCE(al.check_out_at, now()) - al.check_in_at)::integer) > 0 THEN LEAST(100, round(COALESCE(da.online_seconds, os.session_online_seconds, 0)::numeric / NULLIF(EXTRACT(epoch FROM COALESCE(al.check_out_at, now()) - al.check_in_at), 0::numeric) * 100::numeric)::integer)
            ELSE 100
        END AS compliance_score
   FROM driver_days dd
     JOIN drivers d ON d.id = dd.driver_id
     JOIN profiles p ON p.id = d.id
     LEFT JOIN partners pt ON pt.id = d.partner_id
     LEFT JOIN partners pts ON pt.id IS NULL AND lower(pts.slug) = lower(d.project_key)
     LEFT JOIN zones z ON z.id = d.zone_id
     LEFT JOIN shift_window sw ON sw.driver_id = dd.driver_id AND sw.attendance_date = dd.attendance_date
     LEFT JOIN attendance_logs al ON al.driver_id = dd.driver_id AND al.log_date = dd.attendance_date
     LEFT JOIN driver_attendance da ON da.driver_id = dd.driver_id AND da.attendance_date = dd.attendance_date
     LEFT JOIN online_sessions os ON os.driver_id = dd.driver_id AND os.attendance_date = dd.attendance_date
     LEFT JOIN driver_locations dl ON dl.driver_id = d.id
  WHERE d.archived_at IS NULL;

ALTER VIEW public.v_attendance_daily SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- admin_list_attendance_daily — partner via the restaurant, on_leave rank
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_attendance_daily(p_from date, p_to date, p_search text DEFAULT NULL::text, p_partner_id uuid DEFAULT NULL::uuid, p_zone_id uuid DEFAULT NULL::uuid, p_restaurant_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_live_only boolean DEFAULT false, p_sort text DEFAULT 'problems_first'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_total integer;
  v_limit integer := GREATEST(COALESCE(p_limit, 50), 1);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH filtered AS (
    SELECT v.*
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
      AND (NOT p_live_only OR v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date)
      AND (
        p_partner_id IS NULL
        OR v.partner_id = p_partner_id
        OR EXISTS (
          SELECT 1
          FROM public.driver_restaurants dr
          JOIN public.restaurants r ON r.id = dr.restaurant_id
          WHERE dr.driver_id = v.driver_id
            AND r.partner_id = p_partner_id
        )
      )
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
        OR (p_status = 'scheduled' AND v.scheduled_start_at IS NOT NULL)
        OR (p_status = 'checked_in' AND (v.check_in_at IS NOT NULL OR v.is_on_duty))
        OR (p_status = 'late' AND v.minutes_late > 0)
        OR (p_status = 'absent' AND v.live_status = 'absent')
        OR (
          p_status = 'online'
          AND v.is_on_duty
          AND v.live_status = 'on_duty'
        )
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
  ranked AS (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN p_sort = 'problems_first' THEN
              CASE f.live_status
                WHEN 'late' THEN 1
                WHEN 'offline_during_shift' THEN 2
                WHEN 'gps_stale' THEN 3
                WHEN 'outside_zone' THEN 4
                WHEN 'absent' THEN 5
                ELSE 10
              END
            WHEN p_sort IN ('status_asc', 'status_desc') THEN
              CASE f.live_status
                WHEN 'late' THEN 1
                WHEN 'offline_during_shift' THEN 2
                WHEN 'gps_stale' THEN 3
                WHEN 'outside_zone' THEN 4
                WHEN 'absent' THEN 5
                WHEN 'on_leave' THEN 6
                WHEN 'on_duty' THEN 7
                WHEN 'present' THEN 8
                WHEN 'completed' THEN 9
                WHEN 'scheduled' THEN 10
                WHEN 'no_shift' THEN 11
                ELSE 12
              END
            ELSE 0
          END * CASE WHEN p_sort = 'status_desc' THEN -1 ELSE 1 END,
          CASE WHEN p_sort IN ('problems_first', 'date_desc') THEN f.log_date END DESC NULLS LAST,
          CASE WHEN p_sort = 'date_asc' THEN f.log_date END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_asc' THEN f.driver_name END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_desc' THEN f.driver_name END DESC NULLS LAST,
          CASE WHEN p_sort IN ('last_seen', 'last_seen_desc') THEN f.last_seen_at END DESC NULLS LAST,
          CASE WHEN p_sort = 'last_seen_asc' THEN f.last_seen_at END ASC NULLS LAST,
          CASE WHEN p_sort = 'check_in_asc' THEN f.check_in_at END ASC NULLS LAST,
          CASE WHEN p_sort = 'check_in_desc' THEN f.check_in_at END DESC NULLS LAST,
          CASE WHEN p_sort = 'check_out_asc' THEN f.check_out_at END ASC NULLS LAST,
          CASE WHEN p_sort = 'check_out_desc' THEN f.check_out_at END DESC NULLS LAST,
          CASE
            WHEN p_sort = 'duty_seconds_asc' THEN
              COALESCE(
                NULLIF(f.duty_seconds, 0),
                CASE
                  WHEN f.check_in_at IS NOT NULL AND f.check_out_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (f.check_out_at - f.check_in_at))::integer
                  ELSE NULL
                END,
                0
              )
          END ASC NULLS LAST,
          CASE
            WHEN p_sort = 'duty_seconds_desc' THEN
              COALESCE(
                NULLIF(f.duty_seconds, 0),
                CASE
                  WHEN f.check_in_at IS NOT NULL AND f.check_out_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (f.check_out_at - f.check_in_at))::integer
                  ELSE NULL
                END,
                0
              )
          END DESC NULLS LAST,
          CASE WHEN p_sort = 'on_duty_asc' THEN f.is_on_duty::integer END ASC NULLS LAST,
          CASE WHEN p_sort = 'on_duty_desc' THEN f.is_on_duty::integer END DESC NULLS LAST,
          CASE WHEN p_sort IN ('status_asc', 'status_desc', 'problems_first')
            THEN f.check_in_at END DESC NULLS LAST,
          f.driver_name ASC
      ) AS _rn
    FROM filtered f
  ),
  paged AS (
    SELECT *
    FROM ranked r
    WHERE r._rn > v_offset
      AND r._rn <= v_offset + v_limit
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg((to_jsonb(p) - '_rn') ORDER BY p._rn)
        FROM paged p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'totalCount', COALESCE(v_total, 0),
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- admin_attendance_kpis — same partner predicate, honest Online count
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_attendance_kpis(p_date date, p_partner_id uuid DEFAULT NULL::uuid, p_zone_id uuid DEFAULT NULL::uuid, p_restaurant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    COUNT(*) FILTER (WHERE v.is_on_duty AND v.live_status = 'on_duty'),
    COUNT(*) FILTER (WHERE v.live_status IN (
      'late', 'absent', 'offline_during_shift', 'gps_stale', 'outside_zone'
    )),
    ROUND(AVG(v.compliance_score) FILTER (WHERE v.compliance_score IS NOT NULL))
  INTO v_scheduled, v_checked_in, v_late, v_absent, v_online, v_problems, v_compliance
  FROM public.v_attendance_daily v
  WHERE v.log_date = p_date
    AND (
      p_partner_id IS NULL
      OR v.partner_id = p_partner_id
      OR EXISTS (
        SELECT 1
        FROM public.driver_restaurants dr
        JOIN public.restaurants r ON r.id = dr.restaurant_id
        WHERE dr.driver_id = v.driver_id
          AND r.partner_id = p_partner_id
      )
    )
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
$function$;
