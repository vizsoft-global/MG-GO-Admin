-- Nightly rollup writing driver_performance_daily, and the source function it
-- shares with the live read of today.
--
-- The computation lives in `performance_daily_source` rather than inside the
-- rollup, because the period tab has to show today and the rollup only runs at
-- 02:00. Two copies of this query — one for the write, one for today — would be
-- two copies that can disagree, and the one place a driver would notice is the
-- boundary between today and yesterday, which is exactly where an operator
-- checks whether the number is real.
--
-- Every component is written NULL when its source could not answer for that day,
-- never 0. Zero would read as "measured, and perfect", which for the three
-- fleet_events components is exactly the lie that would appear the moment the
-- rollup reaches back past the retention window: a fleet that looks flawless
-- until the day the feature shipped, then abruptly degrades.

CREATE OR REPLACE FUNCTION public.performance_daily_source(
  p_from date,
  p_to date,
  p_driver_id uuid DEFAULT NULL
)
RETURNS TABLE (
  driver_id uuid,
  log_date date,
  worked boolean,
  on_leave boolean,
  absent boolean,
  lost_minutes numeric,
  scheduled_minutes numeric,
  online_seconds numeric,
  duty_seconds numeric,
  out_of_zone_minutes numeric,
  gps_offline_minutes numeric,
  deliveries_completed integer,
  deliveries_within_sla integer,
  overspeed_events integer,
  sources_complete text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      p_from::timestamp AT TIME ZONE 'Asia/Kuwait' AS from_ts,
      (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait' AS to_ts
  ),
  -- Fleet-wide, not per driver: if nobody produced an event that day we cannot
  -- tell a quiet fleet from a pruned one, so the source is marked unavailable
  -- and the three components it feeds stay NULL rather than claiming perfection.
  fleet_days AS (
    SELECT DISTINCT (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date
    FROM public.fleet_events e, bounds b
    WHERE e.detected_at >= b.from_ts AND e.detected_at < b.to_ts
  ),
  att AS (
    SELECT
      v.driver_id,
      v.log_date,
      (
        v.check_in_at IS NOT NULL
        AND v.attendance_status IS DISTINCT FROM 'on_leave'
        AND v.attendance_status IS DISTINCT FROM 'absent'
        AND v.live_status IS DISTINCT FROM 'absent'
      ) AS worked,
      (v.attendance_status = 'on_leave') AS on_leave,
      (
        v.attendance_status = 'absent'
        OR (v.live_status = 'absent' AND v.attendance_status IS DISTINCT FROM 'on_leave')
      ) AS absent,
      CASE
        WHEN v.check_in_at IS NULL OR v.scheduled_start_at IS NULL THEN NULL
        ELSE (COALESCE(v.minutes_late, 0) + COALESCE(v.minutes_early_out, 0))::numeric
      END AS lost_minutes,
      CASE
        WHEN v.scheduled_start_at IS NULL OR v.scheduled_end_at IS NULL THEN NULL
        ELSE GREATEST(
          (EXTRACT(EPOCH FROM (v.scheduled_end_at - v.scheduled_start_at)) / 60.0)::numeric,
          0
        )
      END AS scheduled_minutes,
      CASE
        WHEN v.check_in_at IS NULL THEN NULL
        ELSE v.online_seconds::numeric
      END AS online_seconds,
      CASE
        WHEN v.check_in_at IS NULL OR COALESCE(v.duty_seconds, 0) <= 0 THEN NULL
        ELSE v.duty_seconds::numeric
      END AS duty_seconds
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
      AND (p_driver_id IS NULL OR v.driver_id = p_driver_id)
  ),
  -- Deliveries are attributed to the Kuwait date they were delivered on, which
  -- is the rule admin_count_eligible_deliveries_on_dates already uses. A
  -- delivery with no pickup_at has no duration, so it leaves both sides of the
  -- ratio rather than counting as a miss.
  del AS (
    SELECT
      d.driver_id,
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date,
      COUNT(*)::integer AS deliveries_completed,
      COUNT(*) FILTER (
        WHERE d.delivered_at - d.pickup_at
              <= make_interval(mins => public.resolve_delivery_sla_minutes(d.zone_id, d.partner_id))
      )::integer AS deliveries_within_sla
    FROM public.deliveries d, bounds b
    WHERE d.delivered_at >= b.from_ts AND d.delivered_at < b.to_ts
      AND d.pickup_at IS NOT NULL
      -- in_transit is excluded because delivered_at defaults to now() on insert,
      -- so an open pickup carries a delivered_at that means nothing yet.
      AND d.status::text NOT IN ('cancelled', 'rejected', 'in_transit')
      AND (p_driver_id IS NULL OR d.driver_id = p_driver_id)
    GROUP BY d.driver_id, (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
  ),
  speed AS (
    SELECT
      e.driver_id,
      (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date,
      COUNT(*)::integer AS overspeed_events
    FROM public.fleet_events e, bounds b
    WHERE e.detected_at >= b.from_ts AND e.detected_at < b.to_ts
      AND e.event_key = 'overspeed.start'
      AND (p_driver_id IS NULL OR e.driver_id = p_driver_id)
    GROUP BY e.driver_id, (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date
  ),
  -- Zone and GPS are durations, not counts, so each opening event pairs with the
  -- next event of the same category. An episode still open at the end of the
  -- Kuwait day is closed at midnight rather than dropped: a rider who went
  -- offline at 23:00 and never came back was offline for that hour.
  paired AS (
    SELECT
      e.driver_id,
      (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date,
      CASE WHEN e.event_key IN ('zone.exit', 'zone.entry') THEN 'zone' ELSE 'gps' END AS category,
      e.event_key,
      e.detected_at,
      LEAD(e.detected_at) OVER (
        PARTITION BY
          e.driver_id,
          (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date,
          CASE WHEN e.event_key IN ('zone.exit', 'zone.entry') THEN 'zone' ELSE 'gps' END
        ORDER BY e.detected_at
      ) AS next_at
    FROM public.fleet_events e, bounds b
    WHERE e.detected_at >= b.from_ts AND e.detected_at < b.to_ts
      AND e.event_key IN ('zone.exit', 'zone.entry', 'gps.offline', 'gps.restored')
      AND (p_driver_id IS NULL OR e.driver_id = p_driver_id)
  ),
  episodes AS (
    SELECT
      p.driver_id,
      p.log_date,
      p.category,
      SUM(
        GREATEST(
          (
            EXTRACT(
              EPOCH FROM (
                LEAST(
                  COALESCE(p.next_at, (p.log_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'),
                  (p.log_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
                ) - p.detected_at
              )
            ) / 60.0
          )::numeric,
          0
        )
      ) AS minutes
    FROM paired p
    WHERE p.event_key IN ('zone.exit', 'gps.offline')
    GROUP BY p.driver_id, p.log_date, p.category
  )
  SELECT
    a.driver_id,
    a.log_date,
    a.worked,
    a.on_leave,
    a.absent,
    a.lost_minutes,
    a.scheduled_minutes,
    a.online_seconds,
    a.duty_seconds,
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(ez.minutes, 0) END,
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(eg.minutes, 0) END,
    dl.deliveries_completed,
    dl.deliveries_within_sla,
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(sp.overspeed_events, 0) END,
    (
      ARRAY['attendance']::text[]
      || CASE WHEN dl.driver_id IS NOT NULL THEN ARRAY['deliveries'] ELSE ARRAY[]::text[] END
      || CASE WHEN fd.log_date IS NOT NULL THEN ARRAY['fleet_events'] ELSE ARRAY[]::text[] END
    )
  FROM att a
  LEFT JOIN del dl ON dl.driver_id = a.driver_id AND dl.log_date = a.log_date
  LEFT JOIN speed sp ON sp.driver_id = a.driver_id AND sp.log_date = a.log_date
  LEFT JOIN episodes ez
    ON ez.driver_id = a.driver_id AND ez.log_date = a.log_date AND ez.category = 'zone'
  LEFT JOIN episodes eg
    ON eg.driver_id = a.driver_id AND eg.log_date = a.log_date AND eg.category = 'gps'
  LEFT JOIN fleet_days fd ON fd.log_date = a.log_date;
$$;

REVOKE ALL ON FUNCTION public.performance_daily_source(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.performance_daily_source(date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.performance_daily_source(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.performance_daily_source(date, date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Rollup writer.
--
-- Idempotent by construction: an upsert keyed on (driver_id, log_date), so a
-- re-run replaces rather than accumulates. That matters more than it sounds —
-- the cron retries, and a backfill is a manual operation an operator will run
-- twice while checking whether it worked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_rebuild_driver_performance_daily(
  p_from date,
  p_to date,
  p_driver_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_written integer := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  -- A wide accidental range would rewrite years of rows inside one transaction.
  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  WITH upserted AS (
    INSERT INTO public.driver_performance_daily AS t (
      driver_id, log_date, worked, on_leave, absent,
      lost_minutes, scheduled_minutes, online_seconds, duty_seconds,
      out_of_zone_minutes, gps_offline_minutes,
      deliveries_completed, deliveries_within_sla, overspeed_events,
      sources_complete, computed_at
    )
    SELECT
      s.driver_id, s.log_date, s.worked, s.on_leave, s.absent,
      s.lost_minutes, s.scheduled_minutes, s.online_seconds, s.duty_seconds,
      s.out_of_zone_minutes, s.gps_offline_minutes,
      s.deliveries_completed, s.deliveries_within_sla, s.overspeed_events,
      s.sources_complete, now()
    FROM public.performance_daily_source(p_from, p_to, p_driver_id) s
    ON CONFLICT (driver_id, log_date) DO UPDATE SET
      worked = EXCLUDED.worked,
      on_leave = EXCLUDED.on_leave,
      absent = EXCLUDED.absent,
      lost_minutes = EXCLUDED.lost_minutes,
      scheduled_minutes = EXCLUDED.scheduled_minutes,
      online_seconds = EXCLUDED.online_seconds,
      duty_seconds = EXCLUDED.duty_seconds,
      out_of_zone_minutes = EXCLUDED.out_of_zone_minutes,
      gps_offline_minutes = EXCLUDED.gps_offline_minutes,
      deliveries_completed = EXCLUDED.deliveries_completed,
      deliveries_within_sla = EXCLUDED.deliveries_within_sla,
      overspeed_events = EXCLUDED.overspeed_events,
      -- conduct_weighted is deliberately untouched. Phase 3 owns it, and a
      -- rebuild must not blank a column this statement never computed.
      sources_complete = EXCLUDED.sources_complete,
      computed_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_written FROM upserted;

  RETURN COALESCE(v_written, 0);
END;
$$;

-- Service role only. Postgres grants EXECUTE to PUBLIC by default, which would
-- let any signed-in rider rewrite the whole fleet's rollup.
REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Nightly entry point.
--
-- Rebuilds a trailing window rather than only yesterday: a delivery verified
-- late, an attendance correction, or a shift edited after the fact all change a
-- day that has already closed, and a rollup that only ever wrote yesterday would
-- keep the stale answer forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_run_performance_daily_rollup(
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_from date;
  v_written integer;
BEGIN
  v_from := v_today - GREATEST(COALESCE(p_lookback_days, 7), 1);
  v_written := public.admin_rebuild_driver_performance_daily(v_from, v_today, NULL);

  RETURN jsonb_build_object('from', v_from, 'to', v_today, 'rows', v_written);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_performance_daily_rollup(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_run_performance_daily_rollup(integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_run_performance_daily_rollup(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_performance_daily_rollup(integer) TO service_role;
