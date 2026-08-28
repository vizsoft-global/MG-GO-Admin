-- The zone component counts range exits as well as zone exits.
--
-- Measured on production before changing anything: `zone.exit` has fired
-- exactly ONCE in the entire fleet_events table, against 2,422 `range.exit`
-- rows. That is not a quiet fleet — it is that most production riders carry no
-- `drivers.zone_id`, the same fact that already forced the live tab's zone
-- breakdown to grow an "unassigned" bucket. A component that scores 100 for
-- every driver every day is not a component; it is a constant that dilutes the
-- blend it sits in.
--
-- Folding range into zone is not a new judgement either. Live Tracking V2 has
-- counted Out of Range under "Out of zone" since 2026-08-19 — it paints the same
-- red puck and lands in the same KPI. Scoring it differently from how the map
-- already reports it is what would need justifying.
--
-- Only the pairing category changes. Zone and range episodes are both
-- open/close pairs on the same clock, so a rider outside either boundary is
-- accumulating out-of-zone minutes, and two overlapping episodes are summed the
-- same way two consecutive ones are.

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
    (
      ARRAY['attendance']::text[]
      || CASE WHEN dl.driver_id IS NOT NULL THEN ARRAY['deliveries'] ELSE ARRAY[]::text[] END
      || CASE WHEN fd.log_date IS NOT NULL THEN ARRAY['fleet_events'] ELSE ARRAY[]::text[] END
    )
  FROM att a
  LEFT JOIN del dl ON dl.driver_id = a.driver_id AND dl.log_date = a.log_date
  LEFT JOIN speed sp ON sp.driver_id = a.driver_id AND sp.log_date = a.log_date
  LEFT JOIN outside oz ON oz.driver_id = a.driver_id AND oz.log_date = a.log_date
  LEFT JOIN episodes eg
    ON eg.driver_id = a.driver_id AND eg.log_date = a.log_date AND eg.category = 'gps'
  LEFT JOIN fleet_days fd ON fd.log_date = a.log_date;
$$;

UPDATE public.performance_score_components
SET label_en = 'Zone & range discipline', label_ar = 'الالتزام بالمنطقة والنطاق'
WHERE key = 'zone';
