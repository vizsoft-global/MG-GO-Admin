-- admin_list_driver_performance follows the ratings onto criteria.
--
-- The rating tables re-keyed in 20261005100100, so this function's rating CTEs
-- referenced a column that no longer exists. Rebuilding it is not optional, and
-- the aggregation gains one level rather than changing shape: months average
-- within a criterion, criteria average within their team by criterion weight,
-- and teams average into the manual score by team weight — which is the
-- existing rule and the reason a team that rated three months still does not
-- outvote a team that rated one.
--
-- Normalisation stays where it was, at the very end. (score - 1) / 4 is affine,
-- so applying it before or after the weighted averages gives the same number;
-- doing it last is what lets manual_teams and manual_criteria stay on the 1-5
-- scale a rater actually picked, which is what a reader of the export compares
-- against.

CREATE OR REPLACE FUNCTION public.admin_list_driver_performance(
  p_from date,
  p_to date,
  p_search text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL,
  p_driver_status text DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'overall_desc',
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
  v_max_limit constant integer := 2000;
  v_limit integer;
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_weights jsonb;
  v_w_delivery numeric := 1;
  v_w_utilization numeric := 1;
  v_w_compliance numeric := 1;
  v_w_manual numeric := 0;
  v_exception_penalty numeric := 5;
  v_period_days integer;
  v_month_from date;
  v_month_to date;
  v_kpis jsonb;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_comp jsonb;
  v_components jsonb;
  v_speed_allowance numeric := 2;
  v_conduct_allowance numeric := 0.25;
  v_sla_minutes integer := 45;
  v_criteria jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF COALESCE(p_limit, 50) > v_max_limit THEN
    RAISE EXCEPTION 'limit_too_large';
  END IF;

  v_limit := GREATEST(COALESCE(p_limit, 50), 1);
  v_period_days := (p_to - p_from) + 1;
  v_month_from := date_trunc('month', p_from)::date;
  v_month_to := date_trunc('month', p_to)::date;

  SELECT
    COALESCE(
      s.performance_score_weights,
      '{"delivery":1,"utilization":1,"compliance":1,"manual":0,"exception_penalty":5}'::jsonb
    ),
    COALESCE(s.performance_speed_allowance_per_day, 2),
    COALESCE(s.performance_conduct_allowance_per_day, 0.25),
    COALESCE(s.delivery_ontime_minutes, 45)
  INTO v_weights, v_speed_allowance, v_conduct_allowance, v_sla_minutes
  FROM public.app_settings s
  WHERE s.id = 1;

  v_w_delivery := GREATEST(COALESCE((v_weights->>'delivery')::numeric, 1), 0);
  v_w_utilization := GREATEST(COALESCE((v_weights->>'utilization')::numeric, 1), 0);
  v_w_compliance := GREATEST(COALESCE((v_weights->>'compliance')::numeric, 1), 0);
  v_w_manual := GREATEST(COALESCE((v_weights->>'manual')::numeric, 0), 0);
  v_exception_penalty := GREATEST(COALESCE((v_weights->>'exception_penalty')::numeric, 5), 0);

  IF (v_w_delivery + v_w_utilization + v_w_compliance) = 0 THEN
    v_w_delivery := 1;
    v_w_utilization := 1;
    v_w_compliance := 1;
  END IF;

  -- Component weights, keyed. An inactive component carries weight 0, which is
  -- the same thing as being absent from the blend.
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

  -- Active criteria, so the export can carry one column per criterion driven by
  -- the criteria table rather than by whatever the rows happen to contain: an
  -- absent column and an unrated fleet are different facts.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'team_key', c.team_key,
        'key', c.key,
        'label_en', c.label_en,
        'label_ar', c.label_ar,
        'weight', c.weight,
        'team_label_en', t.label_en,
        'team_label_ar', t.label_ar
      ) ORDER BY t.sort_order, t.key, c.sort_order, c.key
    ),
    '[]'::jsonb
  )
  INTO v_criteria
  FROM public.performance_rating_criteria c
  JOIN public.performance_rating_teams t ON t.key = c.team_key
  WHERE c.is_active AND t.is_active AND c.weight > 0;

  WITH drivers_base AS (
    SELECT
      dr.id AS driver_id,
      dr.driver_code,
      dr.employee_id,
      dr.status AS driver_status,
      dr.partner_id,
      dr.zone_id,
      dr.is_on_duty,
      COALESCE(pr.full_name, '—') AS driver_name,
      COALESCE(pr.phone, '—') AS driver_phone,
      pt.name AS partner_name,
      z.name AS zone_name
    FROM public.drivers dr
    JOIN public.profiles pr ON pr.id = dr.id
    LEFT JOIN public.partners pt ON pt.id = dr.partner_id
    LEFT JOIN public.zones z ON z.id = dr.zone_id
    WHERE dr.archived_at IS NULL
      AND (p_driver_id IS NULL OR dr.id = p_driver_id)
      AND (p_partner_id IS NULL OR dr.partner_id = p_partner_id)
      AND (p_zone_id IS NULL OR dr.zone_id = p_zone_id)
      AND (
        p_driver_status IS NULL
        OR p_driver_status = 'all'
        OR dr.status::text = p_driver_status
      )
      AND (
        p_restaurant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.driver_restaurants drr
          WHERE drr.driver_id = dr.id AND drr.restaurant_id = p_restaurant_id
        )
      )
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR pr.full_name ILIKE '%' || btrim(p_search) || '%'
        OR dr.driver_code ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(dr.employee_id, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  att AS (
    SELECT
      v.driver_id,
      COUNT(*) FILTER (
        WHERE v.check_in_at IS NOT NULL
          AND v.attendance_status IS DISTINCT FROM 'on_leave'
          AND v.attendance_status IS DISTINCT FROM 'absent'
          AND v.live_status IS DISTINCT FROM 'absent'
      )::integer AS worked_days,
      COUNT(*) FILTER (WHERE v.attendance_status = 'on_leave')::integer AS leave_days,
      COUNT(*) FILTER (
        WHERE v.attendance_status = 'absent'
          OR (v.live_status = 'absent' AND v.attendance_status IS DISTINCT FROM 'on_leave')
      )::integer AS absent_days,
      AVG(v.compliance_score) FILTER (
        WHERE v.compliance_score IS NOT NULL
          AND v.attendance_status IS DISTINCT FROM 'on_leave'
          AND v.attendance_status IS DISTINCT FROM 'absent'
          AND v.live_status IS DISTINCT FROM 'absent'
      ) AS avg_compliance,
      ARRAY_AGG(v.log_date) FILTER (
        WHERE v.check_in_at IS NOT NULL
          AND v.attendance_status IS DISTINCT FROM 'on_leave'
          AND v.attendance_status IS DISTINCT FROM 'absent'
          AND v.live_status IS DISTINCT FROM 'absent'
      ) AS worked_dates
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
      AND v.driver_id IN (SELECT db.driver_id FROM drivers_base db)
    GROUP BY v.driver_id
  ),
  -- Closed days come from the rollup; today is computed live off the same
  -- source function the rollup writes from, so the two cannot drift.
  roll_src AS (
    SELECT
      r.driver_id, r.log_date, r.worked,
      r.lost_minutes, r.scheduled_minutes, r.online_seconds, r.duty_seconds,
      r.out_of_zone_minutes, r.gps_offline_minutes,
      r.deliveries_completed, r.deliveries_within_sla, r.overspeed_events,
      r.conduct_weighted
    FROM public.driver_performance_daily r
    WHERE r.log_date BETWEEN p_from AND LEAST(p_to, v_today - 1)
      AND r.driver_id IN (SELECT db.driver_id FROM drivers_base db)
    UNION ALL
    SELECT
      s.driver_id, s.log_date, s.worked,
      s.lost_minutes, s.scheduled_minutes, s.online_seconds, s.duty_seconds,
      s.out_of_zone_minutes, s.gps_offline_minutes,
      s.deliveries_completed, s.deliveries_within_sla, s.overspeed_events,
      NULL::numeric
    FROM public.performance_daily_source(GREATEST(p_from, v_today), p_to, p_driver_id) s
    WHERE s.driver_id IN (SELECT db.driver_id FROM drivers_base db)
  ),
  -- Time-based components average their per-day score across worked days: a
  -- shift is the unit of adherence, so one 14-hour Saturday must not dominate a
  -- month. Count-based ones pool numerator and denominator across the window,
  -- because three late deliveries out of five on a quiet day would otherwise
  -- outvote zero out of forty on a busy one.
  roll AS (
    SELECT
      r.driver_id,
      AVG(
        CASE
          WHEN r.worked AND COALESCE(r.scheduled_minutes, 0) > 0 AND r.lost_minutes IS NOT NULL
          THEN LEAST(GREATEST(1 - (r.lost_minutes / r.scheduled_minutes), 0), 1)
        END
      ) AS s_punctuality,
      AVG(
        CASE
          WHEN r.worked AND COALESCE(r.duty_seconds, 0) > 0 AND r.online_seconds IS NOT NULL
          THEN LEAST(GREATEST(r.online_seconds / r.duty_seconds, 0), 1)
        END
      ) AS s_duty_ratio,
      AVG(
        CASE
          WHEN r.worked AND COALESCE(r.duty_seconds, 0) > 0 AND r.out_of_zone_minutes IS NOT NULL
          THEN LEAST(GREATEST(1 - (r.out_of_zone_minutes / (r.duty_seconds / 60.0)), 0), 1)
        END
      ) AS s_zone,
      AVG(
        CASE
          WHEN r.worked AND COALESCE(r.duty_seconds, 0) > 0 AND r.gps_offline_minutes IS NOT NULL
          THEN LEAST(GREATEST(1 - (r.gps_offline_minutes / (r.duty_seconds / 60.0)), 0), 1)
        END
      ) AS s_gps,
      SUM(r.deliveries_completed)::numeric AS del_total,
      SUM(r.deliveries_within_sla)::numeric AS del_sla,
      SUM(r.overspeed_events)::numeric AS overspeed_total,
      -- Allowances are a rate per worked day, so the same driver scores the same
      -- whether the operator asked for a week or a month.
      COUNT(*) FILTER (WHERE r.worked AND r.overspeed_events IS NOT NULL)::numeric AS speed_days,
      SUM(r.conduct_weighted)::numeric AS conduct_total,
      COUNT(*) FILTER (WHERE r.worked AND r.conduct_weighted IS NOT NULL)::numeric AS conduct_days
    FROM roll_src r
    GROUP BY r.driver_id
  ),
  comp AS (
    SELECT
      r.driver_id,
      r.s_punctuality,
      r.s_duty_ratio,
      r.s_zone,
      r.s_gps,
      CASE WHEN COALESCE(r.del_total, 0) > 0 THEN r.del_sla / r.del_total END AS s_on_time,
      CASE
        WHEN COALESCE(r.speed_days, 0) > 0 AND v_speed_allowance > 0
        THEN LEAST(
          GREATEST(1 - (COALESCE(r.overspeed_total, 0) / (v_speed_allowance * r.speed_days)), 0),
          1
        )
      END AS s_speed,
      CASE
        WHEN COALESCE(r.conduct_days, 0) > 0 AND v_conduct_allowance > 0
        THEN LEAST(
          GREATEST(1 - (COALESCE(r.conduct_total, 0) / (v_conduct_allowance * r.conduct_days)), 0),
          1
        )
      END AS s_conduct
    FROM roll r
  ),
  blended AS (
    SELECT
      c.driver_id,
      c.s_punctuality, c.s_duty_ratio, c.s_zone, c.s_gps, c.s_on_time, c.s_speed, c.s_conduct,
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
    FROM comp c
  ),
  exc AS (
    SELECT
      e.driver_id,
      COUNT(*)::integer AS exception_count,
      -- Only the types no component measures still cost points. The other four
      -- are scored as components now, and charging both would be a double count.
      COUNT(*) FILTER (
        WHERE e.exception_type IN ('NoCheckIn', 'NoAssignedShift', 'OfflineDuringShift')
      )::integer AS penalised_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'exception_type', e.exception_type,
            'exception_date', e.exception_date,
            'severity', e.severity,
            'resolution_status', e.resolution_status
          )
          ORDER BY e.exception_date DESC
        ),
        '[]'::jsonb
      ) AS exceptions
    FROM public.v_attendance_exceptions e
    WHERE e.exception_date BETWEEN p_from AND p_to
      AND e.driver_id IN (SELECT db.driver_id FROM drivers_base db)
      AND COALESCE(e.resolution_status, 'open') IN ('open', 'acknowledged')
    GROUP BY e.driver_id
  ),
  -- Per criterion, then per team, then across teams. Each step exists to stop a
  -- different thing from outvoting another: months within a criterion, criteria
  -- within a team, and teams within the manual score.
  rat_crit AS (
    SELECT
      r.driver_id,
      c.id AS criterion_id,
      c.team_key,
      c.key AS criterion_key,
      c.weight AS criterion_weight,
      AVG(r.score)::numeric AS crit_avg,
      COUNT(*)::integer AS months_rated,
      MAX(r.rated_at) AS last_rated_at
    FROM public.driver_performance_ratings r
    JOIN public.performance_rating_criteria c ON c.id = r.criterion_id AND c.is_active
    JOIN public.performance_rating_teams t ON t.key = c.team_key AND t.is_active
    WHERE r.period_month BETWEEN v_month_from AND v_month_to
      AND r.driver_id IN (SELECT db.driver_id FROM drivers_base db)
    GROUP BY r.driver_id, c.id, c.team_key, c.key, c.weight
  ),
  -- An unrated criterion drops with its weight, the same rule the component
  -- blend uses: a criterion nobody scored is not a criterion scored badly.
  rat_team AS (
    SELECT
      rc.driver_id,
      rc.team_key,
      CASE
        WHEN SUM(GREATEST(rc.criterion_weight, 0)) > 0
          THEN SUM(GREATEST(rc.criterion_weight, 0) * rc.crit_avg)
               / SUM(GREATEST(rc.criterion_weight, 0))
        ELSE AVG(rc.crit_avg)
      END AS team_avg,
      MAX(rc.months_rated) AS months_rated,
      MAX(rc.last_rated_at) AS last_rated_at
    FROM rat_crit rc
    GROUP BY rc.driver_id, rc.team_key
  ),
  rat_crit_map AS (
    SELECT
      rc.driver_id,
      jsonb_object_agg(
        rc.team_key || '.' || rc.criterion_key,
        ROUND(rc.crit_avg, 2)
      ) AS manual_criteria
    FROM rat_crit rc
    GROUP BY rc.driver_id
  ),
  rat AS (
    SELECT
      rt.driver_id,
      CASE
        WHEN SUM(COALESCE(t.weight, 1)) > 0
          THEN SUM(COALESCE(t.weight, 1) * rt.team_avg) / SUM(COALESCE(t.weight, 1))
        ELSE NULL
      END AS manual_avg_raw,
      COUNT(*)::integer AS manual_rating_count,
      jsonb_agg(
        jsonb_build_object(
          'team_key', rt.team_key,
          'score', ROUND(rt.team_avg, 2),
          'months_rated', rt.months_rated,
          'last_rated_at', rt.last_rated_at
        )
        ORDER BY t.sort_order, rt.team_key
      ) AS manual_teams,
      MAX(rcm.manual_criteria) AS manual_criteria
    FROM rat_team rt
    JOIN public.performance_rating_teams t ON t.key = rt.team_key
    LEFT JOIN rat_crit_map rcm ON rcm.driver_id = rt.driver_id
    GROUP BY rt.driver_id
  ),
  scored AS (
    SELECT
      d.*,
      COALESCE(a.worked_days, 0) AS worked_days,
      COALESCE(a.leave_days, 0) AS leave_days,
      COALESCE(a.absent_days, 0) AS absent_days,
      GREATEST(
        v_period_days - COALESCE(a.leave_days, 0) - COALESCE(a.absent_days, 0),
        0
      ) AS eligible_days,
      COALESCE(a.worked_dates, ARRAY[]::date[]) AS worked_dates,
      a.avg_compliance AS legacy_compliance_raw,
      COALESCE(x.exception_count, 0) AS exception_count,
      COALESCE(x.penalised_count, 0) AS penalised_count,
      COALESCE(x.exceptions, '[]'::jsonb) AS exceptions,
      b.s_punctuality, b.s_duty_ratio, b.s_zone, b.s_gps, b.s_on_time, b.s_speed, b.s_conduct,
      b.blend_num,
      COALESCE(b.blend_den, 0) AS blend_den,
      rr.manual_avg_raw,
      COALESCE(rr.manual_rating_count, 0) AS manual_rating_count,
      COALESCE(rr.manual_teams, '[]'::jsonb) AS manual_teams,
      COALESCE(rr.manual_criteria, '{}'::jsonb) AS manual_criteria,
      t.rule_id,
      t.period AS incentive_period,
      COALESCE(t.target_deliveries, 0) AS rule_target
    FROM drivers_base d
    LEFT JOIN att a ON a.driver_id = d.driver_id
    LEFT JOIN exc x ON x.driver_id = d.driver_id
    LEFT JOIN blended b ON b.driver_id = d.driver_id
    LEFT JOIN rat rr ON rr.driver_id = d.driver_id
    LEFT JOIN LATERAL (
      SELECT rt.rule_id, rt.period, rt.target_deliveries
      FROM public.admin_resolve_driver_incentive_target(d.driver_id, p_to) rt
    ) t ON true
  ),
  with_metrics AS (
    SELECT
      s.*,
      CASE
        WHEN s.eligible_days <= 0 THEN 0::numeric
        ELSE LEAST(s.worked_days::numeric / s.eligible_days::numeric, 1)
      END AS utilization,
      public.admin_count_eligible_deliveries_on_dates(
        s.driver_id,
        s.rule_id,
        s.worked_dates
      ) AS actual_deliveries,
      CASE
        WHEN s.rule_id IS NULL OR COALESCE(s.rule_target, 0) <= 0 OR s.eligible_days <= 0 THEN 0
        WHEN s.incentive_period = 'daily' THEN ROUND(s.rule_target * s.eligible_days)::integer
        WHEN s.incentive_period = 'weekly' THEN
          GREATEST(ROUND(s.rule_target * (s.eligible_days::numeric / 7.0)), 1)::integer
        WHEN s.incentive_period = 'monthly' THEN
          GREATEST(ROUND(s.rule_target * (s.eligible_days::numeric / 30.0)), 1)::integer
        ELSE s.rule_target
      END AS target_deliveries,
      -- NULL when no component could be measured. Not 0: that would read as
      -- "measured, and terrible" for a driver nobody has data on.
      CASE
        WHEN s.blend_den > 0 THEN
          GREATEST(
            0,
            LEAST(
              100,
              (100 * s.blend_num / s.blend_den) - (s.penalised_count * v_exception_penalty)
            )
          )
      END AS compliance_score,
      -- Kept alongside so the settings preview can show old against new for the
      -- same fleet and the same range.
      CASE
        WHEN s.legacy_compliance_raw IS NULL THEN NULL
        ELSE GREATEST(
          0,
          LEAST(100, s.legacy_compliance_raw - (s.exception_count * v_exception_penalty))
        )
      END AS legacy_compliance_score,
      -- 1-5 onto 0-1 with the midpoint preserved. NULL when unrated, which is
      -- what makes the renormalisation below possible.
      CASE
        WHEN s.manual_avg_raw IS NULL THEN NULL
        ELSE LEAST(GREATEST((s.manual_avg_raw - 1) / 4.0, 0), 1)
      END AS manual_ratio
    FROM scored s
  ),
  final_rows AS (
    SELECT
      m.*,
      CASE
        WHEN m.target_deliveries <= 0 THEN 0::numeric
        ELSE m.actual_deliveries::numeric / m.target_deliveries::numeric
      END AS delivery_efficiency_raw,
      CASE
        WHEN m.target_deliveries <= 0 THEN 0::numeric
        ELSE LEAST(m.actual_deliveries::numeric / m.target_deliveries::numeric, 1)
      END AS delivery_efficiency,
      CASE
        WHEN m.manual_ratio IS NULL THEN NULL
        ELSE ROUND(m.manual_ratio * 100, 1)
      END AS manual_score,
      jsonb_strip_nulls(
        jsonb_build_object(
          'punctuality', ROUND(m.s_punctuality, 4),
          'duty_ratio', ROUND(m.s_duty_ratio, 4),
          'on_time', ROUND(m.s_on_time, 4),
          'speed', ROUND(m.s_speed, 4),
          'zone', ROUND(m.s_zone, 4),
          'gps', ROUND(m.s_gps, 4),
          'conduct', ROUND(m.s_conduct, 4)
        )
      ) AS component_scores,
      ROUND(
        100 * (
          v_w_delivery * CASE
            WHEN m.target_deliveries <= 0 THEN 0
            ELSE LEAST(m.actual_deliveries::numeric / m.target_deliveries::numeric, 1)
          END
          + v_w_utilization * m.utilization
          + CASE
              WHEN m.compliance_score IS NULL THEN 0
              ELSE v_w_compliance * (m.compliance_score / 100.0)
            END
          + CASE
              WHEN m.manual_ratio IS NULL THEN 0
              ELSE v_w_manual * m.manual_ratio
            END
        ) / NULLIF(
          v_w_delivery + v_w_utilization
          + CASE WHEN m.compliance_score IS NULL THEN 0 ELSE v_w_compliance END
          + CASE WHEN m.manual_ratio IS NULL THEN 0 ELSE v_w_manual END,
          0
        ),
        1
      ) AS overall_score
    FROM with_metrics m
  ),
  counted AS (
    SELECT COUNT(*)::integer AS total FROM final_rows
  ),
  ranked AS (
    SELECT
      f.*,
      RANK() OVER (ORDER BY f.overall_score DESC NULLS LAST)::integer AS dpd_rank,
      CASE
        WHEN f.overall_score >= 80 THEN 'top'
        WHEN f.overall_score >= 70 THEN 'good'
        WHEN f.overall_score >= 50 THEN 'watch'
        ELSE 'critical'
      END AS score_band,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort = 'overall_desc' THEN f.overall_score END DESC NULLS LAST,
          CASE WHEN p_sort = 'overall_asc' THEN f.overall_score END ASC NULLS LAST,
          CASE WHEN p_sort = 'delivery_desc' THEN f.delivery_efficiency END DESC NULLS LAST,
          CASE WHEN p_sort = 'delivery_asc' THEN f.delivery_efficiency END ASC NULLS LAST,
          CASE WHEN p_sort = 'utilization_desc' THEN f.utilization END DESC NULLS LAST,
          CASE WHEN p_sort = 'utilization_asc' THEN f.utilization END ASC NULLS LAST,
          CASE WHEN p_sort = 'compliance_desc' THEN f.compliance_score END DESC NULLS LAST,
          CASE WHEN p_sort = 'compliance_asc' THEN f.compliance_score END ASC NULLS LAST,
          CASE WHEN p_sort = 'manual_desc' THEN f.manual_score END DESC NULLS LAST,
          CASE WHEN p_sort = 'manual_asc' THEN f.manual_score END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_asc' THEN f.driver_name END ASC NULLS LAST,
          CASE WHEN p_sort = 'name_desc' THEN f.driver_name END DESC NULLS LAST,
          f.overall_score DESC NULLS LAST,
          f.driver_name ASC
      ) AS _rn
    FROM final_rows f
  ),
  paged AS (
    SELECT * FROM ranked r
    WHERE r._rn > v_offset AND r._rn <= v_offset + v_limit
  ),
  kpi_src AS (
    SELECT
      ROUND(AVG(overall_score), 1) AS avg_overall,
      ROUND(AVG(delivery_efficiency) * 100, 1) AS avg_delivery_pct,
      ROUND(AVG(utilization) * 100, 1) AS avg_utilization_pct,
      ROUND(AVG(compliance_score) FILTER (WHERE compliance_score IS NOT NULL), 1) AS avg_compliance,
      ROUND(
        AVG(legacy_compliance_score) FILTER (WHERE legacy_compliance_score IS NOT NULL), 1
      ) AS avg_legacy_compliance,
      COUNT(*) FILTER (WHERE overall_score < 70)::integer AS below_threshold,
      ROUND(MAX(overall_score), 1) AS top_score,
      ROUND(MIN(overall_score), 1) AS bottom_score,
      (
        SELECT f.driver_name
        FROM final_rows f
        ORDER BY f.overall_score DESC NULLS LAST, f.driver_name ASC
        LIMIT 1
      ) AS top_driver_name,
      (
        SELECT f.driver_name
        FROM final_rows f
        ORDER BY f.overall_score ASC NULLS LAST, f.driver_name ASC
        LIMIT 1
      ) AS bottom_driver_name,
      COUNT(*) FILTER (WHERE overall_score >= 80)::integer AS band_top,
      COUNT(*) FILTER (WHERE overall_score >= 70 AND overall_score < 80)::integer AS band_good,
      COUNT(*) FILTER (WHERE overall_score >= 50 AND overall_score < 70)::integer AS band_watch,
      COUNT(*) FILTER (WHERE overall_score < 50)::integer AS band_critical,
      -- Averaged over rated drivers only: an average that counted unrated ones
      -- as 0 would describe review coverage, not rating quality.
      ROUND(AVG(manual_score) FILTER (WHERE manual_score IS NOT NULL), 1) AS avg_manual,
      COUNT(*) FILTER (WHERE manual_rating_count > 0)::integer AS rated_drivers
    FROM final_rows
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'driver_id', p.driver_id,
            'driver_code', p.driver_code,
            'employee_id', p.employee_id,
            'driver_name', p.driver_name,
            'driver_phone', p.driver_phone,
            'driver_status', p.driver_status,
            'partner_id', p.partner_id,
            'partner_name', p.partner_name,
            'zone_id', p.zone_id,
            'zone_name', p.zone_name,
            'is_on_duty', p.is_on_duty,
            'worked_days', p.worked_days,
            'leave_days', p.leave_days,
            'absent_days', p.absent_days,
            'eligible_days', p.eligible_days,
            'period_days', v_period_days,
            'actual_deliveries', p.actual_deliveries,
            'target_deliveries', p.target_deliveries,
            'rule_id', p.rule_id,
            'incentive_period', p.incentive_period,
            'rule_target', p.rule_target,
            'delivery_efficiency', ROUND(p.delivery_efficiency::numeric, 4),
            'delivery_efficiency_raw', ROUND(p.delivery_efficiency_raw::numeric, 4),
            'utilization', ROUND(p.utilization::numeric, 4),
            'compliance_score', ROUND(p.compliance_score::numeric, 1),
            'legacy_compliance_score', ROUND(p.legacy_compliance_score::numeric, 1),
            'component_scores', p.component_scores,
            'exception_count', p.exception_count,
            'penalised_exception_count', p.penalised_count,
            'exceptions', p.exceptions,
            'manual_score', p.manual_score,
            'manual_rating_count', p.manual_rating_count,
            'manual_teams', p.manual_teams,
            'manual_criteria', p.manual_criteria,
            'overall_score', p.overall_score,
            'dpd_rank', p.dpd_rank,
            'score_band', p.score_band
          )
          ORDER BY p._rn
        )
        FROM paged p
      ),
      '[]'::jsonb
    ),
    (SELECT to_jsonb(k) FROM kpi_src k)
  INTO v_total, v_rows, v_kpis;

  RETURN jsonb_build_object(
    'totalCount', COALESCE(v_total, 0),
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'kpis', COALESCE(v_kpis, '{}'::jsonb),
    'weights', COALESCE(
      v_weights,
      '{"delivery":1,"utilization":1,"compliance":1,"manual":0,"exception_penalty":5}'::jsonb
    ),
    'components', COALESCE(v_components, '[]'::jsonb),
    'criteria', COALESCE(v_criteria, '[]'::jsonb),
    'slaMinutes', v_sla_minutes,
    'from', p_from,
    'to', p_to,
    'maxExportRows', v_max_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_driver_performance(
  date, date, text, uuid, uuid, uuid, text, uuid, text, integer, integer
) TO authenticated;
