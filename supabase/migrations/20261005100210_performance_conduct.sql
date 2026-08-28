-- The conduct component starts measuring.
--
-- Everything downstream of `conduct_weighted` already exists: the column, the
-- allowance setting, the scoring expression in all three readers, and the
-- component row itself — seeded inactive because `wrong_actions` had no admin
-- surface to fill it. Phase 3 gives it one, so this migration is only the two
-- ends: computing the number, and switching the component on.
--
-- Severity weights are `low` 1, `medium` 2, `high` 3, straight off the existing
-- `severity_level` enum. Weighting rather than counting is the whole point: a
-- rider with one high-severity incident and a rider with one late uniform check
-- have not had the same month, and a flat count says they have.
--
-- The denominator is `allowance_per_worked_day x worked_days`, applied in the
-- readers, not here. This function stores the raw weighted count for the same
-- reason it stores every other raw numerator: a stored score would freeze
-- today's allowance into history, and the settings preview exists precisely to
-- ask what last month looks like under a different one.
--
-- `wrong_actions` joins `attendance` as a source that is always available. It is
-- an admin-authored ledger with no retention job, so an empty day is a day with
-- no incidents — which is genuinely a zero, not an unknown. That is the opposite
-- of `fleet_events`, where an empty day cannot be told from a pruned one and the
-- three components it feeds must stay NULL. The one case that is still unknown
-- is a day the driver did not work, and the per-worked-day allowance already
-- drops those: zero worked days gives a zero allowance, which yields NULL.

DROP FUNCTION IF EXISTS public.performance_daily_source(date, date, uuid);

CREATE FUNCTION public.performance_daily_source(
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
  conduct_weighted numeric,
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
  -- Attributed to the Kuwait date the incident occurred on, not the date it was
  -- filed: an admin entering last Tuesday's uniform failure today is recording
  -- something that happened on Tuesday, and scoring it against today's shift
  -- would move a day the rider has already been told about.
  conduct AS (
    SELECT
      w.driver_id,
      (w.occurred_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date,
      SUM(
        CASE w.severity
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END
      )::numeric AS conduct_weighted
    FROM public.wrong_actions w, bounds b
    WHERE w.occurred_at >= b.from_ts AND w.occurred_at < b.to_ts
      AND (p_driver_id IS NULL OR w.driver_id = p_driver_id)
    GROUP BY w.driver_id, (w.occurred_at AT TIME ZONE 'Asia/Kuwait')::date
  ),
  paired AS (
    SELECT
      e.driver_id,
      (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date AS log_date,
      CASE
        WHEN e.event_key IN ('zone.exit', 'zone.entry') THEN 'zone'
        WHEN e.event_key IN ('range.exit', 'range.entry') THEN 'range'
        ELSE 'gps'
      END AS category,
      e.event_key,
      e.detected_at,
      LEAD(e.detected_at) OVER (
        PARTITION BY
          e.driver_id,
          (e.detected_at AT TIME ZONE 'Asia/Kuwait')::date,
          CASE
            WHEN e.event_key IN ('zone.exit', 'zone.entry') THEN 'zone'
            WHEN e.event_key IN ('range.exit', 'range.entry') THEN 'range'
            ELSE 'gps'
          END
        ORDER BY e.detected_at
      ) AS next_at
    FROM public.fleet_events e, bounds b
    WHERE e.detected_at >= b.from_ts AND e.detected_at < b.to_ts
      AND e.event_key IN (
        'zone.exit', 'zone.entry',
        'range.exit', 'range.entry',
        'gps.offline', 'gps.restored'
      )
      AND (p_driver_id IS NULL OR e.driver_id = p_driver_id)
  ),
  -- An episode still open at the end of the Kuwait day is closed at midnight
  -- rather than dropped: a rider who went offline at 23:00 and never came back
  -- was offline for that hour.
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
    WHERE p.event_key IN ('zone.exit', 'range.exit', 'gps.offline')
    GROUP BY p.driver_id, p.log_date, p.category
  ),
  outside AS (
    SELECT
      e.driver_id,
      e.log_date,
      SUM(e.minutes) AS minutes
    FROM episodes e
    WHERE e.category IN ('zone', 'range')
    GROUP BY e.driver_id, e.log_date
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
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(oz.minutes, 0) END,
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(eg.minutes, 0) END,
    dl.deliveries_completed,
    dl.deliveries_within_sla,
    CASE WHEN fd.log_date IS NULL THEN NULL ELSE COALESCE(sp.overspeed_events, 0) END,
    -- COALESCE, not the fleet_days treatment above: a day with no incident rows
    -- is a clean day, and the ledger is never pruned.
    COALESCE(wa.conduct_weighted, 0),
    (
      ARRAY['attendance', 'wrong_actions']::text[]
      || CASE WHEN dl.driver_id IS NOT NULL THEN ARRAY['deliveries'] ELSE ARRAY[]::text[] END
      || CASE WHEN fd.log_date IS NOT NULL THEN ARRAY['fleet_events'] ELSE ARRAY[]::text[] END
    )
  FROM att a
  LEFT JOIN del dl ON dl.driver_id = a.driver_id AND dl.log_date = a.log_date
  LEFT JOIN speed sp ON sp.driver_id = a.driver_id AND sp.log_date = a.log_date
  LEFT JOIN conduct wa ON wa.driver_id = a.driver_id AND wa.log_date = a.log_date
  LEFT JOIN outside oz ON oz.driver_id = a.driver_id AND oz.log_date = a.log_date
  LEFT JOIN episodes eg
    ON eg.driver_id = a.driver_id AND eg.log_date = a.log_date AND eg.category = 'gps'
  LEFT JOIN fleet_days fd ON fd.log_date = a.log_date;
$$;

REVOKE ALL ON FUNCTION public.performance_daily_source(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.performance_daily_source(date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.performance_daily_source(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.performance_daily_source(date, date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The rollup now writes the column it used to skip.
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

  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  WITH upserted AS (
    INSERT INTO public.driver_performance_daily AS t (
      driver_id, log_date, worked, on_leave, absent,
      lost_minutes, scheduled_minutes, online_seconds, duty_seconds,
      out_of_zone_minutes, gps_offline_minutes,
      deliveries_completed, deliveries_within_sla, overspeed_events,
      conduct_weighted, sources_complete, computed_at
    )
    SELECT
      s.driver_id, s.log_date, s.worked, s.on_leave, s.absent,
      s.lost_minutes, s.scheduled_minutes, s.online_seconds, s.duty_seconds,
      s.out_of_zone_minutes, s.gps_offline_minutes,
      s.deliveries_completed, s.deliveries_within_sla, s.overspeed_events,
      s.conduct_weighted, s.sources_complete, now()
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
      conduct_weighted = EXCLUDED.conduct_weighted,
      sources_complete = EXCLUDED.sources_complete,
      computed_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_written FROM upserted;

  RETURN COALESCE(v_written, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rebuild_driver_performance_daily(date, date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The component itself.
--
-- Seeded at weight 0, not at 1. Activating it at a live weight would re-score
-- the whole fleet on deploy against a ledger that is empty today — every driver
-- would gain a free perfect component and their compliance would move for a
-- reason nobody asked for. At weight 0 the blend is byte-identical to what
-- shipped in Phase 1, the settings editor shows the component with its preview,
-- and an admin turns it on once there are incidents worth scoring. This is the
-- same argument that seeded the manual pillar at 0.
-- ---------------------------------------------------------------------------
UPDATE public.performance_score_components
SET is_active = true,
    weight = 0,
    label_en = 'Conduct',
    label_ar = 'السلوك'
WHERE key = 'conduct';
