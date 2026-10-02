-- 20261103000000_attendance_daily_view_inline_online_sessions.sql
--
-- P4-B: /attendance server-side pagination was wired but had no effect, because the
-- cost sat inside `v_attendance_daily` and did not respond to p_limit.
--
-- PROBLEM (measured on eoksxkdssptgyqyywdju, authenticated staff session):
--   admin_list_attendance_daily(2026-09-01..2026-09-30, limit 50) = 350.3 ms / 148,941 buffers
--   the same call with limit 500                              = 369.0 ms / 148,973 buffers
--   i.e. the page size changed the payload but not the work.
--
-- ROOT CAUSE:
--   `driver_days` was referenced TWICE (once as the driving row source, once inside
--   `online_sessions`), which forces Postgres to MATERIALIZE the CTE. A materialised
--   CTE carries no column statistics, so a consumer's `log_date BETWEEN p_from AND p_to`
--   fell back to the default 0.5% range selectivity: 182 estimated rows against 9,669
--   actual (53x underestimate). The planner then chose nested loops and probed
--   attendance_logs / driver_daily_shifts / driver_locations / drivers once per
--   driver-day -> 9,669 index probes per table, 115,561-148,941 shared buffer hits.
--
-- CHANGE:
--   `online_sessions` now derives its own (driver_id, Kuwait-day) groups from
--   `driver_sessions` directly instead of joining `driver_days` first. `driver_days`
--   is therefore referenced exactly once, so it is inlined, each UNION arm keeps its
--   own index-able predicate, and the planner sees real cardinality and picks hash
--   joins on its own -- no planner hint is pinned.
--
--   Semantics are unchanged: `online_sessions` may now hold (driver, day) pairs that
--   `driver_days` does not contain, and those rows can never match the
--   LEFT JOIN ... ON os.driver_id = dd.driver_id AND os.attendance_date = dd.attendance_date.
--   The outer SELECT is untouched, so all 29 output columns are identical.
--
-- VERIFIED (inside a rolled-back production transaction):
--   CREATE TEMP TABLE snap AS SELECT * FROM v_attendance_daily;  -- 13,085 rows
--   ... replace view ...
--   (snap EXCEPT ALL view) = 0 rows  AND  (view EXCEPT ALL snap) = 0 rows
--   admin_list_attendance_daily      350.3 ms / 148,941 buf -> 204.9 ms / 4,874 buf
--   admin_list_attendance_exceptions  59.3 ms /   8,304 buf ->  25.6 ms / 1,342 buf
--   admin_list_driver_performance  1,254.1 ms / 307,950 buf -> 948.4 ms / 48,032 buf
--   admin_attendance_kpis             60.3 ms               ->  27.3 ms
--   admin_dpd_efficiency_snapshot  2,460.8 ms               -> 2,429.1 ms (neutral)
--   performance_daily_source       5,511.5 ms               -> 5,367.3 ms (neutral)
--
-- SCOPE: read-only view body. No RLS policy, grant, permission, route gate or
-- table/column is touched; `security_invoker = true` is re-asserted below.
-- Rollback: restore the previous body, i.e. change the `online_sessions` CTE back to
--   online_sessions AS (
--     SELECT dd_1.driver_id, dd_1.attendance_date,
--            COALESCE(sum(EXTRACT(epoch FROM COALESCE(sess.went_offline_at, now()) - sess.went_online_at))::integer, 0)
--       FROM driver_days dd_1
--       JOIN driver_sessions sess ON sess.driver_id = dd_1.driver_id
--      WHERE (sess.went_online_at AT TIME ZONE 'Asia/Kuwait')::date = dd_1.attendance_date
--      GROUP BY dd_1.driver_id, dd_1.attendance_date
--   )

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
    d.partner_id,
    pt.name AS partner_name,
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
            WHEN sw.scheduled_start_at IS NULL THEN 'no_shift'::text
            WHEN al.check_in_at IS NULL THEN 'absent'::text
            WHEN GREATEST(0,
            CASE
                WHEN al.check_in_at IS NOT NULL AND sw.scheduled_start_at IS NOT NULL THEN (EXTRACT(epoch FROM al.check_in_at - sw.scheduled_start_at) / 60::numeric)::integer - (( SELECT settings.late_grace
                   FROM settings))
                ELSE 0
            END) > 0 THEN 'late'::text
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date AND NOT (EXISTS ( SELECT 1
               FROM driver_sessions s
              WHERE s.driver_id = d.id AND s.is_online = true)) THEN 'offline_during_shift'::text
            WHEN d.is_on_duty AND al.check_in_at IS NOT NULL AND al.check_out_at IS NULL AND dd.attendance_date = (now() AT TIME ZONE 'Asia/Kuwait'::text)::date AND dl.last_seen_at IS NOT NULL AND dl.last_seen_at < (now() - (((( SELECT settings.gps_stale
               FROM settings)) || ' minutes'::text)::interval)) THEN 'gps_stale'::text
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
     LEFT JOIN zones z ON z.id = d.zone_id
     LEFT JOIN shift_window sw ON sw.driver_id = dd.driver_id AND sw.attendance_date = dd.attendance_date
     LEFT JOIN attendance_logs al ON al.driver_id = dd.driver_id AND al.log_date = dd.attendance_date
     LEFT JOIN driver_attendance da ON da.driver_id = dd.driver_id AND da.attendance_date = dd.attendance_date
     LEFT JOIN online_sessions os ON os.driver_id = dd.driver_id AND os.attendance_date = dd.attendance_date
     LEFT JOIN driver_locations dl ON dl.driver_id = d.id
  WHERE d.archived_at IS NULL;

-- CREATE OR REPLACE VIEW preserves grants but the security_invoker option is
-- re-asserted explicitly so a future rebuild cannot silently drop it.
ALTER VIEW public.v_attendance_daily SET (security_invoker = true);
