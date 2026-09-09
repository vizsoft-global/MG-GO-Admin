-- Wave 2 read-only daily incentive report.
-- Day = driver_earnings_daily.earn_date (Asia/Kuwait civil date). No upsert.

CREATE OR REPLACE FUNCTION public.admin_incentive_daily_report(
  p_from date,
  p_to date,
  p_driver_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL
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

  RETURN (
    WITH scoped AS (
      SELECT
        e.id,
        e.driver_id,
        e.earn_date,
        e.deliveries,
        e.incentive_kwd,
        COALESCE(pr.full_name, '—') AS driver_name,
        dr.employee_id,
        dr.driver_code,
        z.name AS zone_name,
        (
          SELECT string_agg(r.name, ', ' ORDER BY r.name)
          FROM public.driver_restaurants drr
          JOIN public.restaurants r ON r.id = drr.restaurant_id
          WHERE drr.driver_id = e.driver_id
        ) AS restaurant_name,
        CASE
          WHEN jsonb_typeof(e.breakdown) = 'array' THEN (
            SELECT string_agg(DISTINCT NULLIF(x->>'rule_name', ''), ', ')
            FROM jsonb_array_elements(e.breakdown) x
          )
          ELSE NULLIF(e.breakdown->>'rule_name', '')
        END AS applied_rule
      FROM public.driver_earnings_daily e
      JOIN public.drivers dr ON dr.id = e.driver_id
      JOIN public.profiles pr ON pr.id = e.driver_id
      LEFT JOIN public.zones z ON z.id = dr.zone_id
      WHERE e.earn_date BETWEEN v_from AND v_to
        AND (p_driver_id IS NULL OR e.driver_id = p_driver_id)
        AND (
          p_restaurant_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.driver_restaurants drr
            WHERE drr.driver_id = e.driver_id
              AND drr.restaurant_id = p_restaurant_id
          )
        )
    )
    SELECT jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'rows', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'driver_id', s.driver_id,
              'driver_name', s.driver_name,
              'employee_id', s.employee_id,
              'driver_code', s.driver_code,
              'earn_date', s.earn_date,
              'restaurant_name', s.restaurant_name,
              'zone_name', s.zone_name,
              'deliveries', s.deliveries,
              'applied_rule', s.applied_rule,
              'daily_amount_kwd', s.incentive_kwd,
              'period_total_kwd', s.period_total_kwd
            )
            ORDER BY s.earn_date DESC, s.driver_name
          )
          FROM (
            SELECT
              scoped.*,
              SUM(scoped.incentive_kwd) OVER (PARTITION BY scoped.driver_id) AS period_total_kwd
            FROM scoped
          ) s
        ),
        '[]'::jsonb
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_incentive_daily_report(date, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_incentive_daily_report(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_incentive_daily_report(date, date, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.admin_incentive_daily_report(date, date, uuid, uuid) IS
  'Staff-only daily incentive rows. Day is earn_date (Kuwait calendar). Apply/upsert is not this function.';
