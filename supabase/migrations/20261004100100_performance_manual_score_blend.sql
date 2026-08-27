-- Blend the Fleet / HR / Operations rating into overall_score.
--
-- Three decisions worth stating, because each has a wrong answer that looks
-- reasonable:
--
-- 1. A 1-5 rating normalises as (score - 1) / 4, not score / 5. The scale's
--    midpoint has to land on the score's midpoint — 3 of 5 is "average", and
--    average must read as 50, not 60. It also means a 1 is genuinely punitive
--    rather than worth 20 points to a rider three teams rated worst-possible.
--
-- 2. A driver with no rating is not penalised. Treating "unrated" as 0 would
--    make the manual weight a penalty for whatever the review cycle has not
--    reached yet, so the manual term is dropped and the remaining weights
--    renormalise — an unrated driver scores exactly what they scored before
--    this migration, whatever the manual weight is set to.
--
-- 3. Ratings are averaged per team across the months the range covers, then
--    across teams by team weight. Averaging the rows directly would let a team
--    that rated three months outvote a team that rated one.
--
-- The manual weight is seeded at 0, so this is inert until an admin opts in.

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

  SELECT COALESCE(
    s.performance_score_weights,
    '{"delivery":1,"utilization":1,"compliance":1,"manual":0,"exception_penalty":5}'::jsonb
  )
  INTO v_weights
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
  exc AS (
    SELECT
      e.driver_id,
      COUNT(*)::integer AS exception_count,
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
  -- Per team first, so three monthly Fleet ratings cannot outvote one HR rating.
  rat_team AS (
    SELECT
      r.driver_id,
      r.team_key,
      AVG(r.score)::numeric AS team_avg,
      COUNT(*)::integer AS months_rated,
      MAX(r.rated_at) AS last_rated_at
    FROM public.driver_performance_ratings r
    JOIN public.performance_rating_teams t ON t.key = r.team_key AND t.is_active
    WHERE r.period_month BETWEEN v_month_from AND v_month_to
      AND r.driver_id IN (SELECT db.driver_id FROM drivers_base db)
    GROUP BY r.driver_id, r.team_key
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
      ) AS manual_teams
    FROM rat_team rt
    JOIN public.performance_rating_teams t ON t.key = rt.team_key
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
      COALESCE(a.avg_compliance, 0)::numeric AS avg_compliance_raw,
      COALESCE(x.exception_count, 0) AS exception_count,
      COALESCE(x.exceptions, '[]'::jsonb) AS exceptions,
      rr.manual_avg_raw,
      COALESCE(rr.manual_rating_count, 0) AS manual_rating_count,
      COALESCE(rr.manual_teams, '[]'::jsonb) AS manual_teams,
      t.rule_id,
      t.period AS incentive_period,
      COALESCE(t.target_deliveries, 0) AS rule_target
    FROM drivers_base d
    LEFT JOIN att a ON a.driver_id = d.driver_id
    LEFT JOIN exc x ON x.driver_id = d.driver_id
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
      GREATEST(
        0,
        LEAST(
          100,
          COALESCE(s.avg_compliance_raw, 0) - (s.exception_count * v_exception_penalty)
        )
      ) AS compliance_score,
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
      ROUND(
        100 * (
          v_w_delivery * CASE
            WHEN m.target_deliveries <= 0 THEN 0
            ELSE LEAST(m.actual_deliveries::numeric / m.target_deliveries::numeric, 1)
          END
          + v_w_utilization * m.utilization
          + v_w_compliance * (m.compliance_score / 100.0)
          + CASE
              WHEN m.manual_ratio IS NULL THEN 0
              ELSE v_w_manual * m.manual_ratio
            END
        ) / (
          v_w_delivery + v_w_utilization + v_w_compliance
          + CASE WHEN m.manual_ratio IS NULL THEN 0 ELSE v_w_manual END
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
      ROUND(AVG(compliance_score), 1) AS avg_compliance,
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
            'exception_count', p.exception_count,
            'exceptions', p.exceptions,
            'manual_score', p.manual_score,
            'manual_rating_count', p.manual_rating_count,
            'manual_teams', p.manual_teams,
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
    'from', p_from,
    'to', p_to,
    'maxExportRows', v_max_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_driver_performance(
  date, date, text, uuid, uuid, uuid, text, uuid, text, integer, integer
) TO authenticated;
