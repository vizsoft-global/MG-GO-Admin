-- Management analysis: one call, every series.
--
-- The analysis tab asks four questions at once — how the fleet is trending, how
-- this window compares with the one before it, how the score splits by zone,
-- partner and rating team, and how many drivers changed band. Four client
-- queries would each carry their own latency and could disagree mid-refresh,
-- showing a trend computed after a rollup that the band migration beside it had
-- not read. Same argument that produced `admin_dpd_live_snapshot`.
--
-- It reads `driver_performance_daily`. `admin_list_driver_performance` was
-- measured at ~148ms for the whole fleet over ONE day; a 90-day trend that
-- recomputed the composite per bucket would be seconds per poll. The rollup
-- exists precisely so this is a scan over pre-computed numerators. Today is the
-- one exception and comes from `performance_daily_source`, exactly as the
-- per-day breakdown does — without it the newest bucket of a window ending today
-- would be silently empty, which reads as a fleet that stopped working.
--
-- What it deliberately does NOT chart is the composite score. The trend is over
-- the component blend, which is what the components in the legend add up to;
-- charting the composite would fold delivery and utilisation into a line whose
-- legend claims to be components.

-- ---------------------------------------------------------------------------
-- Permission. Granted to every role already holding performance.view, or the
-- tab vanishes for all four existing roles the moment it ships — the same trap
-- performance.view itself had to handle when /performance stopped borrowing
-- drivers.view.
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('performance.analyze', 'View performance analysis', 'performance')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'performance.analyze'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'performance.view'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Trend
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_performance_trend(date, date, text, uuid, uuid);

CREATE FUNCTION public.admin_performance_trend(
  p_from date,
  p_to date,
  p_bucket text DEFAULT 'day',
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp jsonb;
  v_components jsonb;
  v_speed_allowance numeric := 2;
  v_conduct_allowance numeric := 0.25;
  v_bucket text;
  v_days integer;
  v_prev_from date;
  v_prev_to date;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('performance.analyze') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  -- Refused, not clamped. A silently truncated report is the same failure as a
  -- silently short distance total: the caller has no way to know. The cap is on
  -- the requested window, and the comparison window doubles the scan, so this is
  -- 400 days of chart against 800 days of read.
  IF (p_to - p_from) > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_bucket := CASE lower(COALESCE(p_bucket, 'day'))
                WHEN 'week' THEN 'week'
                WHEN 'month' THEN 'month'
                ELSE 'day'
              END;

  -- The comparison window is the same LENGTH immediately before this one, not
  -- the same calendar month. Comparing a 12-day window against a 31-day one
  -- would make every mid-month reading look like a collapse.
  v_days := (p_to - p_from) + 1;
  v_prev_to := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  SELECT
    COALESCE(s.performance_speed_allowance_per_day, 2),
    COALESCE(s.performance_conduct_allowance_per_day, 0.25)
  INTO v_speed_allowance, v_conduct_allowance
  FROM public.app_settings s
  WHERE s.id = 1;

  SELECT COALESCE(jsonb_object_agg(c.key, c.weight) FILTER (WHERE c.is_active), '{}'::jsonb)
  INTO v_comp
  FROM public.performance_score_components c;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key', c.key,
        'label_en', c.label_en,
        'label_ar', c.label_ar,
        'weight', c.weight
      ) ORDER BY c.sort_order, c.key
    ) FILTER (WHERE c.is_active AND c.weight > 0),
    '[]'::jsonb
  )
  INTO v_components
  FROM public.performance_score_components c;

  WITH src AS (
    SELECT
      r.driver_id, r.log_date, r.worked, r.on_leave, r.absent,
      r.lost_minutes, r.scheduled_minutes, r.online_seconds, r.duty_seconds,
      r.out_of_zone_minutes, r.gps_offline_minutes,
      r.deliveries_completed, r.deliveries_within_sla, r.overspeed_events,
      r.conduct_weighted
    FROM public.driver_performance_daily r
    WHERE r.log_date BETWEEN v_prev_from AND LEAST(p_to, v_today - 1)
    UNION ALL
    SELECT
      s.driver_id, s.log_date, s.worked, s.on_leave, s.absent,
      s.lost_minutes, s.scheduled_minutes, s.online_seconds, s.duty_seconds,
      s.out_of_zone_minutes, s.gps_offline_minutes,
      s.deliveries_completed, s.deliveries_within_sla, s.overspeed_events,
      s.conduct_weighted
    FROM public.performance_daily_source(
      GREATEST(v_prev_from, v_today), p_to, NULL
    ) s
  ),
  -- The filters live here rather than in `src` so the archived-driver and
  -- zone/partner rules apply identically to the rolled-up half and the live
  -- half. Applying them twice is how the two halves come to disagree.
  scoped AS (
    SELECT
      s.*,
      dr.zone_id,
      dr.partner_id,
      -- The two halves are labelled, not fetched twice: a period-over-period
      -- delta has to come from the same statement as the number above it.
      (s.log_date >= p_from) AS is_current
    FROM src s
    JOIN public.drivers dr ON dr.id = s.driver_id
    WHERE dr.archived_at IS NULL
      AND (p_zone_id IS NULL OR dr.zone_id = p_zone_id)
      AND (p_partner_id IS NULL OR dr.partner_id = p_partner_id)
  ),
  -- Identical to the per-day expressions in admin_driver_performance_daily and
  -- to the window expressions in admin_list_driver_performance. Three copies is
  -- one too many, but a shared per-row function would be a call per driver-day
  -- across a fleet-wide two-window scan.
  scored AS (
    SELECT
      s.*,
      CASE
        WHEN s.worked AND COALESCE(s.scheduled_minutes, 0) > 0 AND s.lost_minutes IS NOT NULL
        THEN LEAST(GREATEST(1 - (s.lost_minutes / s.scheduled_minutes), 0), 1)
      END AS s_punctuality,
      CASE
        WHEN s.worked AND COALESCE(s.duty_seconds, 0) > 0 AND s.online_seconds IS NOT NULL
        THEN LEAST(GREATEST(s.online_seconds / s.duty_seconds, 0), 1)
      END AS s_duty_ratio,
      CASE
        WHEN s.worked AND COALESCE(s.duty_seconds, 0) > 0 AND s.out_of_zone_minutes IS NOT NULL
        THEN LEAST(GREATEST(1 - (s.out_of_zone_minutes / (s.duty_seconds / 60.0)), 0), 1)
      END AS s_zone,
      CASE
        WHEN s.worked AND COALESCE(s.duty_seconds, 0) > 0 AND s.gps_offline_minutes IS NOT NULL
        THEN LEAST(GREATEST(1 - (s.gps_offline_minutes / (s.duty_seconds / 60.0)), 0), 1)
      END AS s_gps,
      CASE
        WHEN COALESCE(s.deliveries_completed, 0) > 0
        THEN s.deliveries_within_sla::numeric / s.deliveries_completed::numeric
      END AS s_on_time,
      CASE
        WHEN s.worked AND s.overspeed_events IS NOT NULL AND v_speed_allowance > 0
        THEN LEAST(GREATEST(1 - (s.overspeed_events / v_speed_allowance), 0), 1)
      END AS s_speed,
      CASE
        WHEN s.worked AND s.conduct_weighted IS NOT NULL AND v_conduct_allowance > 0
        THEN LEAST(GREATEST(1 - (s.conduct_weighted / v_conduct_allowance), 0), 1)
      END AS s_conduct
    FROM scoped s
  ),
  day AS (
    SELECT
      c.*,
      CASE
        WHEN (
          CASE WHEN c.s_punctuality IS NULL THEN 0 ELSE COALESCE((v_comp->>'punctuality')::numeric, 0) END
          + CASE WHEN c.s_duty_ratio IS NULL THEN 0 ELSE COALESCE((v_comp->>'duty_ratio')::numeric, 0) END
          + CASE WHEN c.s_on_time IS NULL THEN 0 ELSE COALESCE((v_comp->>'on_time')::numeric, 0) END
          + CASE WHEN c.s_speed IS NULL THEN 0 ELSE COALESCE((v_comp->>'speed')::numeric, 0) END
          + CASE WHEN c.s_zone IS NULL THEN 0 ELSE COALESCE((v_comp->>'zone')::numeric, 0) END
          + CASE WHEN c.s_gps IS NULL THEN 0 ELSE COALESCE((v_comp->>'gps')::numeric, 0) END
          + CASE WHEN c.s_conduct IS NULL THEN 0 ELSE COALESCE((v_comp->>'conduct')::numeric, 0) END
        ) > 0
        THEN 100 * (
          COALESCE(CASE WHEN c.s_punctuality IS NULL THEN 0 ELSE COALESCE((v_comp->>'punctuality')::numeric, 0) * c.s_punctuality END, 0)
          + COALESCE(CASE WHEN c.s_duty_ratio IS NULL THEN 0 ELSE COALESCE((v_comp->>'duty_ratio')::numeric, 0) * c.s_duty_ratio END, 0)
          + COALESCE(CASE WHEN c.s_on_time IS NULL THEN 0 ELSE COALESCE((v_comp->>'on_time')::numeric, 0) * c.s_on_time END, 0)
          + COALESCE(CASE WHEN c.s_speed IS NULL THEN 0 ELSE COALESCE((v_comp->>'speed')::numeric, 0) * c.s_speed END, 0)
          + COALESCE(CASE WHEN c.s_zone IS NULL THEN 0 ELSE COALESCE((v_comp->>'zone')::numeric, 0) * c.s_zone END, 0)
          + COALESCE(CASE WHEN c.s_gps IS NULL THEN 0 ELSE COALESCE((v_comp->>'gps')::numeric, 0) * c.s_gps END, 0)
          + COALESCE(CASE WHEN c.s_conduct IS NULL THEN 0 ELSE COALESCE((v_comp->>'conduct')::numeric, 0) * c.s_conduct END, 0)
        ) / (
          CASE WHEN c.s_punctuality IS NULL THEN 0 ELSE COALESCE((v_comp->>'punctuality')::numeric, 0) END
          + CASE WHEN c.s_duty_ratio IS NULL THEN 0 ELSE COALESCE((v_comp->>'duty_ratio')::numeric, 0) END
          + CASE WHEN c.s_on_time IS NULL THEN 0 ELSE COALESCE((v_comp->>'on_time')::numeric, 0) END
          + CASE WHEN c.s_speed IS NULL THEN 0 ELSE COALESCE((v_comp->>'speed')::numeric, 0) END
          + CASE WHEN c.s_zone IS NULL THEN 0 ELSE COALESCE((v_comp->>'zone')::numeric, 0) END
          + CASE WHEN c.s_gps IS NULL THEN 0 ELSE COALESCE((v_comp->>'gps')::numeric, 0) END
          + CASE WHEN c.s_conduct IS NULL THEN 0 ELSE COALESCE((v_comp->>'conduct')::numeric, 0) END
        )
      END AS day_score
    FROM scored c
  ),
  series AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bucket', t.bucket,
          'score', ROUND(t.score, 1),
          'drivers', t.drivers,
          'worked_days', t.worked_days,
          'leave_days', t.leave_days,
          'absent_days', t.absent_days,
          'deliveries', t.deliveries,
          'within_sla', t.within_sla,
          'components', t.components
        ) ORDER BY t.bucket
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT
        date_trunc(v_bucket, d.log_date::timestamp)::date AS bucket,
        AVG(d.day_score) AS score,
        COUNT(DISTINCT d.driver_id)::integer AS drivers,
        COUNT(*) FILTER (WHERE d.worked)::integer AS worked_days,
        COUNT(*) FILTER (WHERE d.on_leave)::integer AS leave_days,
        COUNT(*) FILTER (WHERE d.absent)::integer AS absent_days,
        COALESCE(SUM(d.deliveries_completed), 0)::integer AS deliveries,
        COALESCE(SUM(d.deliveries_within_sla), 0)::integer AS within_sla,
        jsonb_strip_nulls(
          jsonb_build_object(
            'punctuality', ROUND(AVG(d.s_punctuality), 4),
            'duty_ratio', ROUND(AVG(d.s_duty_ratio), 4),
            'on_time', ROUND(AVG(d.s_on_time), 4),
            'speed', ROUND(AVG(d.s_speed), 4),
            'zone', ROUND(AVG(d.s_zone), 4),
            'gps', ROUND(AVG(d.s_gps), 4),
            'conduct', ROUND(AVG(d.s_conduct), 4)
          )
        ) AS components
      FROM day d
      WHERE d.is_current
      GROUP BY 1
    ) t
  ),
  -- Both halves through one expression, so a delta is a subtraction of like
  -- from like rather than of two independently written aggregates.
  halves AS (
    SELECT
      d.is_current,
      jsonb_build_object(
        'score', ROUND(AVG(d.day_score), 1),
        'drivers', COUNT(DISTINCT d.driver_id)::integer,
        'worked_days', COUNT(*) FILTER (WHERE d.worked)::integer,
        'leave_days', COUNT(*) FILTER (WHERE d.on_leave)::integer,
        'absent_days', COUNT(*) FILTER (WHERE d.absent)::integer,
        'deliveries', COALESCE(SUM(d.deliveries_completed), 0)::integer,
        'within_sla', COALESCE(SUM(d.deliveries_within_sla), 0)::integer,
        'sla_rate', CASE
          WHEN COALESCE(SUM(d.deliveries_completed), 0) > 0
          THEN ROUND(100.0 * SUM(d.deliveries_within_sla) / SUM(d.deliveries_completed), 1)
        END,
        'overspeed_events', COALESCE(SUM(d.overspeed_events), 0)::integer,
        'conduct_weighted', COALESCE(SUM(d.conduct_weighted), 0)
      ) AS value
    FROM day d
    GROUP BY d.is_current
  ),
  -- `IS NOT DISTINCT FROM` on the join so the NULL key survives and unassigned
  -- is a bucket rather than a dropped row. Most production riders carry no zone
  -- or partner, which is what made the live tab's first distribution card come
  -- back empty under a KPI reading 420 deliveries.
  by_zone AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', a.zone_id,
          'label', a.label,
          'score', ROUND(a.score, 1),
          'drivers', a.drivers,
          'deliveries', a.deliveries
        ) ORDER BY a.score DESC NULLS LAST, a.label
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT
        d.zone_id,
        COALESCE(z.name, '') AS label,
        AVG(d.day_score) AS score,
        COUNT(DISTINCT d.driver_id)::integer AS drivers,
        COALESCE(SUM(d.deliveries_completed), 0)::integer AS deliveries
      FROM day d
      LEFT JOIN public.zones z ON z.id IS NOT DISTINCT FROM d.zone_id
      WHERE d.is_current
      GROUP BY d.zone_id, z.name
    ) a
  ),
  by_partner AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', a.partner_id,
          'label', a.label,
          'score', ROUND(a.score, 1),
          'drivers', a.drivers,
          'deliveries', a.deliveries
        ) ORDER BY a.score DESC NULLS LAST, a.label
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT
        d.partner_id,
        COALESCE(pt.name, '') AS label,
        AVG(d.day_score) AS score,
        COUNT(DISTINCT d.driver_id)::integer AS drivers,
        COALESCE(SUM(d.deliveries_completed), 0)::integer AS deliveries
      FROM day d
      LEFT JOIN public.partners pt ON pt.id IS NOT DISTINCT FROM d.partner_id
      WHERE d.is_current
      GROUP BY d.partner_id, pt.name
    ) a
  ),
  -- One score per driver per half. Everything below that needs a driver-level
  -- number reads this, so the band migration and the team cut cannot disagree
  -- about what a driver scored.
  driver_halves AS (
    SELECT
      d.driver_id,
      AVG(d.day_score) FILTER (WHERE d.is_current) AS score_now,
      AVG(d.day_score) FILTER (WHERE NOT d.is_current) AS score_prev
    FROM day d
    WHERE d.day_score IS NOT NULL
    GROUP BY d.driver_id
  ),
  team_rated AS (
    SELECT cc.team_key, rr.driver_id, AVG(rr.score) AS avg_score
    FROM public.driver_performance_ratings rr
    JOIN public.performance_rating_criteria cc ON cc.id = rr.criterion_id
    WHERE rr.period_month BETWEEN date_trunc('month', p_from)::date
                              AND date_trunc('month', p_to)::date
    GROUP BY cc.team_key, rr.driver_id
  ),
  -- The average measured score of the drivers a team rated, beside the average
  -- star that team gave them. Two different measurements shown together on
  -- purpose: "does the team that rates these riders well also see them score
  -- well" is the question a rating rubric has to be able to answer about itself.
  by_team AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', a.key,
          'label', a.label,
          'score', ROUND(a.score, 1),
          'drivers', a.drivers,
          'avg_rating', ROUND(a.avg_rating, 2)
        ) ORDER BY a.sort_order, a.key
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT
        t.key,
        t.label_en AS label,
        t.sort_order,
        AVG(dh.score_now) AS score,
        COUNT(DISTINCT tr.driver_id)::integer AS drivers,
        AVG(tr.avg_score) AS avg_rating
      FROM public.performance_rating_teams t
      LEFT JOIN team_rated tr ON tr.team_key = t.key
      LEFT JOIN driver_halves dh ON dh.driver_id = tr.driver_id
      WHERE t.is_active
      GROUP BY t.key, t.label_en, t.sort_order
    ) a
  ),
  -- Ranked rather than named so a move is a comparison of two integers. Same
  -- thresholds as admin_list_driver_performance: top 80, good 70, watch 50.
  banded AS (
    SELECT
      h.driver_id,
      CASE
        WHEN h.score_now >= 80 THEN 3
        WHEN h.score_now >= 70 THEN 2
        WHEN h.score_now >= 50 THEN 1
        WHEN h.score_now IS NOT NULL THEN 0
      END AS rank_now,
      CASE
        WHEN h.score_prev >= 80 THEN 3
        WHEN h.score_prev >= 70 THEN 2
        WHEN h.score_prev >= 50 THEN 1
        WHEN h.score_prev IS NOT NULL THEN 0
      END AS rank_prev
    FROM driver_halves h
  ),
  bands AS (
    SELECT jsonb_build_object(
      -- Only a driver scored in BOTH halves can move. A driver who joined this
      -- month has not improved or declined, and counting them as either would
      -- make hiring look like performance.
      'improved', COUNT(*) FILTER (WHERE b.rank_prev IS NOT NULL AND b.rank_now > b.rank_prev),
      'declined', COUNT(*) FILTER (WHERE b.rank_prev IS NOT NULL AND b.rank_now < b.rank_prev),
      'unchanged', COUNT(*) FILTER (WHERE b.rank_prev IS NOT NULL AND b.rank_now = b.rank_prev),
      'current', jsonb_build_object(
        'top', COUNT(*) FILTER (WHERE b.rank_now = 3),
        'good', COUNT(*) FILTER (WHERE b.rank_now = 2),
        'watch', COUNT(*) FILTER (WHERE b.rank_now = 1),
        'critical', COUNT(*) FILTER (WHERE b.rank_now = 0)
      ),
      'previous', jsonb_build_object(
        'top', COUNT(*) FILTER (WHERE b.rank_prev = 3),
        'good', COUNT(*) FILTER (WHERE b.rank_prev = 2),
        'watch', COUNT(*) FILTER (WHERE b.rank_prev = 1),
        'critical', COUNT(*) FILTER (WHERE b.rank_prev = 0)
      )
    ) AS value
    FROM banded b
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'previous_from', v_prev_from,
    'previous_to', v_prev_to,
    'bucket', v_bucket,
    'components', v_components,
    'series', (SELECT value FROM series),
    'totals', COALESCE((SELECT value FROM halves WHERE is_current), '{}'::jsonb),
    'previous_totals', COALESCE((SELECT value FROM halves WHERE NOT is_current), '{}'::jsonb),
    'by_zone', (SELECT value FROM by_zone),
    'by_partner', (SELECT value FROM by_partner),
    'by_team', (SELECT value FROM by_team),
    'bands', (SELECT value FROM bands)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_performance_trend(date, date, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_performance_trend(date, date, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_performance_trend(date, date, text, uuid, uuid) TO authenticated;
