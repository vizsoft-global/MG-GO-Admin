-- Per-day component scores for one driver, for the Attendance page.
--
-- The attendance module already shows a compliance number per day. That number
-- is now a blend, and a blend that cannot be opened is a number an operator has
-- to take on trust — which is exactly the complaint the component work exists to
-- answer. This returns the same components the period tab shows, but one row per
-- day, so "why was Tuesday 62" has an answer on the page where Tuesday lives.
--
-- It reads driver_performance_daily rather than re-deriving from attendance_logs
-- and fleet_events. Re-deriving would be a second implementation of the same
-- rules, and the two would disagree the first time either changed. Today is the
-- one exception: it has not been rolled up yet, so it comes from the same source
-- function the rollup writes from.
--
-- Note the aggregation difference from the period tab, which is deliberate and
-- not a bug: over a window, count-based components pool their numerators, so the
-- window figure is not the average of these per-day figures. A day is a day.

CREATE OR REPLACE FUNCTION public.admin_driver_performance_daily(
  p_driver_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_components jsonb;
  v_comp jsonb;
  v_speed_allowance numeric := 2;
  v_conduct_allowance numeric := 0.25;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_required';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  -- A day view over more than a couple of months is a chart, not a table, and
  -- this function returns a row per day. Refused rather than truncated: a list
  -- that is quietly short is worse than one that says no.
  IF (p_to - p_from) > 92 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

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
      r.log_date, r.worked, r.on_leave, r.absent,
      r.lost_minutes, r.scheduled_minutes, r.online_seconds, r.duty_seconds,
      r.out_of_zone_minutes, r.gps_offline_minutes,
      r.deliveries_completed, r.deliveries_within_sla, r.overspeed_events,
      r.conduct_weighted, r.sources_complete
    FROM public.driver_performance_daily r
    WHERE r.driver_id = p_driver_id
      AND r.log_date BETWEEN p_from AND LEAST(p_to, v_today - 1)
    UNION ALL
    SELECT
      s.log_date, s.worked, s.on_leave, s.absent,
      s.lost_minutes, s.scheduled_minutes, s.online_seconds, s.duty_seconds,
      s.out_of_zone_minutes, s.gps_offline_minutes,
      s.deliveries_completed, s.deliveries_within_sla, s.overspeed_events,
      NULL::numeric, s.sources_complete
    FROM public.performance_daily_source(GREATEST(p_from, v_today), p_to, p_driver_id) s
  ),
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
    FROM src s
  ),
  blended AS (
    SELECT
      c.*,
      (
        COALESCE(CASE WHEN c.s_punctuality IS NULL THEN 0 ELSE COALESCE((v_comp->>'punctuality')::numeric, 0) * c.s_punctuality END, 0)
        + COALESCE(CASE WHEN c.s_duty_ratio IS NULL THEN 0 ELSE COALESCE((v_comp->>'duty_ratio')::numeric, 0) * c.s_duty_ratio END, 0)
        + COALESCE(CASE WHEN c.s_on_time IS NULL THEN 0 ELSE COALESCE((v_comp->>'on_time')::numeric, 0) * c.s_on_time END, 0)
        + COALESCE(CASE WHEN c.s_speed IS NULL THEN 0 ELSE COALESCE((v_comp->>'speed')::numeric, 0) * c.s_speed END, 0)
        + COALESCE(CASE WHEN c.s_zone IS NULL THEN 0 ELSE COALESCE((v_comp->>'zone')::numeric, 0) * c.s_zone END, 0)
        + COALESCE(CASE WHEN c.s_gps IS NULL THEN 0 ELSE COALESCE((v_comp->>'gps')::numeric, 0) * c.s_gps END, 0)
        + COALESCE(CASE WHEN c.s_conduct IS NULL THEN 0 ELSE COALESCE((v_comp->>'conduct')::numeric, 0) * c.s_conduct END, 0)
      ) AS blend_num,
      (
        CASE WHEN c.s_punctuality IS NULL THEN 0 ELSE COALESCE((v_comp->>'punctuality')::numeric, 0) END
        + CASE WHEN c.s_duty_ratio IS NULL THEN 0 ELSE COALESCE((v_comp->>'duty_ratio')::numeric, 0) END
        + CASE WHEN c.s_on_time IS NULL THEN 0 ELSE COALESCE((v_comp->>'on_time')::numeric, 0) END
        + CASE WHEN c.s_speed IS NULL THEN 0 ELSE COALESCE((v_comp->>'speed')::numeric, 0) END
        + CASE WHEN c.s_zone IS NULL THEN 0 ELSE COALESCE((v_comp->>'zone')::numeric, 0) END
        + CASE WHEN c.s_gps IS NULL THEN 0 ELSE COALESCE((v_comp->>'gps')::numeric, 0) END
        + CASE WHEN c.s_conduct IS NULL THEN 0 ELSE COALESCE((v_comp->>'conduct')::numeric, 0) END
      ) AS blend_den
    FROM scored c
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'log_date', b.log_date,
        'worked', b.worked,
        'on_leave', b.on_leave,
        'absent', b.absent,
        'compliance_score',
          CASE WHEN b.blend_den > 0 THEN ROUND(100 * b.blend_num / b.blend_den, 1) END,
        'component_scores', jsonb_strip_nulls(
          jsonb_build_object(
            'punctuality', ROUND(b.s_punctuality, 4),
            'duty_ratio', ROUND(b.s_duty_ratio, 4),
            'on_time', ROUND(b.s_on_time, 4),
            'speed', ROUND(b.s_speed, 4),
            'zone', ROUND(b.s_zone, 4),
            'gps', ROUND(b.s_gps, 4),
            'conduct', ROUND(b.s_conduct, 4)
          )
        ),
        'deliveries_completed', b.deliveries_completed,
        'deliveries_within_sla', b.deliveries_within_sla,
        'overspeed_events', b.overspeed_events,
        'sources_complete', to_jsonb(COALESCE(b.sources_complete, ARRAY[]::text[]))
      )
      ORDER BY b.log_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM blended b;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'components', v_components,
    'from', p_from,
    'to', p_to
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_driver_performance_daily(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_driver_performance_daily(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_driver_performance_daily(uuid, date, date) TO authenticated;
