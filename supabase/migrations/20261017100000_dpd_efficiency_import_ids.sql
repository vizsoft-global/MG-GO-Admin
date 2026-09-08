-- Wave 0/1: per-row employee_id OR driver_code import resolve,
-- DPD target on delivery_rules, and the DPD efficiency snapshot.

CREATE OR REPLACE FUNCTION public.resolve_import_driver_ids(p_import_spec jsonb)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      t.ord,
      NULLIF(btrim(COALESCE(t.elem->>'employee_id', '')), '') AS employee_id,
      NULLIF(btrim(COALESCE(t.elem->>'driver_code', '')), '') AS driver_code
    FROM jsonb_array_elements(COALESCE(p_import_spec->'rows', '[]'::jsonb))
      WITH ORDINALITY AS t(elem, ord)
  ),
  emp_hit AS (
    SELECT r.ord, d.id
    FROM rows r
    JOIN public.drivers d ON d.employee_id = r.employee_id
    WHERE r.employee_id IS NOT NULL
      AND d.archived_at IS NULL
      AND NOT d.is_blocked
  ),
  code_hit AS (
    SELECT r.ord, d.id
    FROM rows r
    JOIN public.drivers d ON d.driver_code = r.driver_code
    WHERE r.driver_code IS NOT NULL
      AND d.archived_at IS NULL
      AND NOT d.is_blocked
  ),
  decided AS (
    SELECT
      CASE
        WHEN e.id IS NOT NULL AND c.id IS NOT NULL AND e.id IS DISTINCT FROM c.id THEN NULL
        WHEN e.id IS NOT NULL THEN e.id
        WHEN c.id IS NOT NULL THEN c.id
        ELSE NULL
      END AS driver_id
    FROM rows r
    LEFT JOIN emp_hit e ON e.ord = r.ord
    LEFT JOIN code_hit c ON c.ord = r.ord
  )
  SELECT COALESCE(array_agg(DISTINCT driver_id), ARRAY[]::uuid[])
  FROM decided
  WHERE driver_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_import_driver_ids(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_import_driver_ids(jsonb) TO service_role;

ALTER TABLE public.delivery_rules
  ADD COLUMN IF NOT EXISTS dpd_target numeric,
  ADD COLUMN IF NOT EXISTS dpd_period public.incentive_period;

COMMENT ON COLUMN public.delivery_rules.dpd_target IS
  'Client DPD efficiency target. Null means this rule does not set a DPD target.';
COMMENT ON COLUMN public.delivery_rules.dpd_period IS
  'Period the DPD target is expressed in (daily / weekly / monthly).';

CREATE OR REPLACE FUNCTION public.admin_dpd_efficiency_snapshot(
  p_from date,
  p_to date,
  p_restaurant_id uuid DEFAULT NULL,
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
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_from := p_from;
  v_to := p_to;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
  IF (v_to - v_from) > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_start := (v_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_end := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  RETURN (
    WITH restaurant_targets AS (
      SELECT DISTINCT ON (restaurant_id)
        restaurant_id,
        dpd_target,
        dpd_period,
        rule_id
      FROM (
        SELECT
          s.restaurant_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id AS rule_id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND s.restaurant_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT
          dr.restaurant_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND dr.restaurant_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
      ) x
      ORDER BY restaurant_id, priority DESC, created_at ASC
    ),
    zone_targets AS (
      SELECT DISTINCT ON (zone_id)
        zone_id,
        dpd_target,
        dpd_period,
        rule_id
      FROM (
        SELECT
          s.zone_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id AS rule_id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND s.zone_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT
          dr.zone_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND dr.zone_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
      ) x
      ORDER BY zone_id, priority DESC, created_at ASC
    ),
    verified AS (
      SELECT
        d.driver_id,
        d.restaurant_id,
        COUNT(*)::integer AS actual
      FROM public.deliveries d
      WHERE d.status = 'verified'
        AND d.delivered_at IS NOT NULL
        AND d.delivered_at >= v_start
        AND d.delivered_at < v_end
        AND (p_restaurant_id IS NULL OR d.restaurant_id = p_restaurant_id)
      GROUP BY d.driver_id, d.restaurant_id
    ),
    actuals AS (
      SELECT driver_id, SUM(actual)::integer AS actual
      FROM verified
      GROUP BY driver_id
    ),
    top_restaurant AS (
      SELECT DISTINCT ON (driver_id)
        driver_id,
        restaurant_id
      FROM verified
      WHERE restaurant_id IS NOT NULL
      ORDER BY driver_id, actual DESC
    ),
    assigned AS (
      SELECT DISTINCT ON (dr.driver_id)
        dr.driver_id,
        dr.restaurant_id
      FROM public.driver_restaurants dr
      ORDER BY dr.driver_id, dr.restaurant_id
    ),
    att AS (
      SELECT
        v.driver_id,
        COUNT(*) FILTER (
          WHERE v.check_in_at IS NOT NULL
            AND v.attendance_status IS DISTINCT FROM 'on_leave'
            AND v.attendance_status IS DISTINCT FROM 'absent'
            AND v.live_status IS DISTINCT FROM 'absent'
        )::integer AS worked_days
      FROM public.v_attendance_daily v
      WHERE v.log_date BETWEEN v_from AND v_to
      GROUP BY v.driver_id
    ),
    riders AS (
      SELECT
        dr.id AS driver_id,
        COALESCE(pr.full_name, '—') AS driver_name,
        dr.employee_id,
        dr.driver_code,
        COALESCE(tr.restaurant_id, asg.restaurant_id) AS restaurant_id,
        r.name AS restaurant_name,
        dr.zone_id,
        z.name AS zone_name,
        COALESCE(a.actual, 0) AS actual,
        COALESCE(a_att.worked_days, 0) AS worked_days,
        CASE
          WHEN rt.dpd_target IS NOT NULL AND rt.dpd_target > 0 THEN rt.dpd_target
          WHEN zt.dpd_target IS NOT NULL AND zt.dpd_target > 0 THEN zt.dpd_target
          WHEN NULLIF(inc.target_deliveries, 0) IS NOT NULL THEN inc.target_deliveries::numeric
          ELSE NULL
        END AS target
      FROM public.drivers dr
      LEFT JOIN public.profiles pr ON pr.id = dr.id
      LEFT JOIN actuals a ON a.driver_id = dr.id
      LEFT JOIN att a_att ON a_att.driver_id = dr.id
      LEFT JOIN top_restaurant tr ON tr.driver_id = dr.id
      LEFT JOIN assigned asg ON asg.driver_id = dr.id
      LEFT JOIN public.restaurants r
        ON r.id = COALESCE(tr.restaurant_id, asg.restaurant_id)
      LEFT JOIN public.zones z ON z.id = dr.zone_id
      LEFT JOIN restaurant_targets rt
        ON rt.restaurant_id = COALESCE(tr.restaurant_id, asg.restaurant_id)
      LEFT JOIN zone_targets zt ON zt.zone_id = dr.zone_id
      LEFT JOIN LATERAL (
        SELECT t.target_deliveries
        FROM public.admin_resolve_driver_incentive_target(dr.id, v_to) t
      ) inc ON true
      WHERE dr.archived_at IS NULL
        AND (COALESCE(a.actual, 0) > 0 OR COALESCE(a_att.worked_days, 0) > 0)
        AND (p_zone_id IS NULL OR dr.zone_id = p_zone_id)
        AND (p_partner_id IS NULL OR dr.partner_id = p_partner_id)
        AND (
          p_restaurant_id IS NULL
          OR COALESCE(tr.restaurant_id, asg.restaurant_id) = p_restaurant_id
          OR EXISTS (
            SELECT 1 FROM public.driver_restaurants drr
            WHERE drr.driver_id = dr.id AND drr.restaurant_id = p_restaurant_id
          )
        )
    ),
    scored AS (
      SELECT
        r.*,
        CASE
          WHEN r.target IS NULL OR r.target <= 0 THEN NULL
          ELSE r.actual::numeric / r.target
        END AS efficiency,
        CASE
          WHEN r.worked_days > 0 THEN r.actual::numeric / r.worked_days
          ELSE NULL
        END AS dpd_rider
      FROM riders r
    ),
    rider_json AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'driver_id', s.driver_id,
            'driver_name', s.driver_name,
            'employee_id', s.employee_id,
            'driver_code', s.driver_code,
            'restaurant_id', s.restaurant_id,
            'restaurant_name', s.restaurant_name,
            'zone_id', s.zone_id,
            'zone_name', s.zone_name,
            'actual', s.actual,
            'target', s.target,
            'efficiency', s.efficiency,
            'dpd_rider', s.dpd_rider,
            'worked_days', s.worked_days
          )
          ORDER BY s.driver_name
        ),
        '[]'::jsonb
      ) AS rows
      FROM scored s
    ),
    ranked AS (
      SELECT *
      FROM scored
      WHERE efficiency IS NOT NULL
    ),
    top10 AS (
      SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.ord), '[]'::jsonb) AS rows
      FROM (
        SELECT
          jsonb_build_object(
            'driver_id', r.driver_id,
            'driver_name', r.driver_name,
            'employee_id', r.employee_id,
            'driver_code', r.driver_code,
            'restaurant_id', r.restaurant_id,
            'restaurant_name', r.restaurant_name,
            'zone_id', r.zone_id,
            'zone_name', r.zone_name,
            'actual', r.actual,
            'target', r.target,
            'efficiency', r.efficiency,
            'dpd_rider', r.dpd_rider,
            'worked_days', r.worked_days
          ) AS row_json,
          ROW_NUMBER() OVER (ORDER BY r.efficiency DESC, r.actual DESC) AS ord
        FROM ranked r
      ) x
      WHERE x.ord <= 10
    ),
    bottom10 AS (
      SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.ord), '[]'::jsonb) AS rows
      FROM (
        SELECT
          jsonb_build_object(
            'driver_id', r.driver_id,
            'driver_name', r.driver_name,
            'employee_id', r.employee_id,
            'driver_code', r.driver_code,
            'restaurant_id', r.restaurant_id,
            'restaurant_name', r.restaurant_name,
            'zone_id', r.zone_id,
            'zone_name', r.zone_name,
            'actual', r.actual,
            'target', r.target,
            'efficiency', r.efficiency,
            'dpd_rider', r.dpd_rider,
            'worked_days', r.worked_days
          ) AS row_json,
          ROW_NUMBER() OVER (ORDER BY r.efficiency ASC, r.actual ASC) AS ord
        FROM ranked r
      ) x
      WHERE x.ord <= 10
    ),
    rest_roll AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.restaurant_id,
            'name', g.restaurant_name,
            'restaurant_id', g.restaurant_id,
            'restaurant_name', g.restaurant_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.restaurant_id,
          s.restaurant_name,
          s.zone_id,
          s.zone_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        GROUP BY s.restaurant_id, s.restaurant_name, s.zone_id, s.zone_name
      ) g
    ),
    zone_roll AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.zone_id,
            'name', g.zone_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.zone_id,
          s.zone_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        GROUP BY s.zone_id, s.zone_name
      ) g
    ),
    zone_rest AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.restaurant_id,
            'name', g.restaurant_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'restaurant_id', g.restaurant_id,
            'restaurant_name', g.restaurant_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.zone_name, g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.zone_id,
          s.zone_name,
          s.restaurant_id,
          s.restaurant_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        WHERE s.restaurant_id IS NOT NULL
        GROUP BY s.zone_id, s.zone_name, s.restaurant_id, s.restaurant_name
      ) g
    )
    SELECT jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'riders', (SELECT rows FROM rider_json),
      'restaurants', (SELECT rows FROM rest_roll),
      'zones', (SELECT rows FROM zone_roll),
      'zone_restaurants', (SELECT rows FROM zone_rest),
      'top10', (SELECT rows FROM top10),
      'bottom10', (SELECT rows FROM bottom10)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dpd_efficiency_snapshot(date, date, uuid, uuid, uuid)
  TO authenticated;
