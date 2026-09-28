-- Order Comparison snapshot: AM from newest applied recon run per (MG ID, day),
-- MGGO live from deliveries (pending / in_transit / verified + delivered_at).
-- Grain is rider+Kuwait day. Restaurant is display-only from the rider profile.
-- Does not change admin_order_recon_compare or order_recon_runs write behaviour.

CREATE INDEX IF NOT EXISTS order_recon_rows_work_date_idx
  ON public.order_recon_rows (work_date);

CREATE INDEX IF NOT EXISTS deliveries_comparison_delivered_at_idx
  ON public.deliveries (delivered_at)
  WHERE delivered_at IS NOT NULL
    AND status IN ('pending', 'in_transit', 'verified');

CREATE OR REPLACE FUNCTION public.admin_order_comparison_snapshot(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_span integer;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  v_span := (p_to - p_from) + 1;
  IF v_span > 93 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  RETURN (
    WITH am_latest AS (
      SELECT DISTINCT ON (lower(btrim(r.employee_id)), r.work_date)
        lower(btrim(r.employee_id)) AS mg_id,
        r.work_date,
        r.run_id,
        r.employee_id AS mg_id_raw,
        r.employee_name AS rider_name
      FROM public.order_recon_rows r
      JOIN public.order_recon_runs ru ON ru.id = r.run_id
      WHERE ru.status = 'applied'
        AND r.work_date BETWEEN p_from AND p_to
        AND btrim(COALESCE(r.employee_id, '')) <> ''
      ORDER BY lower(btrim(r.employee_id)), r.work_date, ru.created_at DESC
    ),
    am AS (
      SELECT
        l.mg_id,
        l.mg_id_raw,
        l.work_date,
        COALESCE(SUM(r.excel_orders), 0)::integer AS orders,
        MAX(l.rider_name) AS rider_name
      FROM am_latest l
      JOIN public.order_recon_rows r
        ON r.run_id = l.run_id
       AND r.work_date = l.work_date
       AND lower(btrim(r.employee_id)) = l.mg_id
      GROUP BY 1, 2, 3
    ),
    mggo AS (
      SELECT
        lower(btrim(dr.employee_id)) AS mg_id,
        MAX(dr.employee_id) AS mg_id_raw,
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS work_date,
        count(*)::integer AS orders
      FROM public.deliveries d
      JOIN public.drivers dr ON dr.id = d.driver_id
      WHERE d.status IN ('pending', 'in_transit', 'verified')
        AND d.delivered_at IS NOT NULL
        AND d.delivered_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kuwait')
        AND d.delivered_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
        AND btrim(COALESCE(dr.employee_id, '')) <> ''
      GROUP BY 1, 3
    ),
    keys AS (
      SELECT mg_id FROM am
      UNION
      SELECT mg_id FROM mggo
    ),
    riders AS (
      SELECT
        lower(btrim(dr.employee_id)) AS mg_id,
        dr.id AS driver_id,
        dr.employee_id AS mg_id_raw,
        COALESCE(p.full_name, '') AS rider_name,
        COALESCE((
          SELECT rst.name
          FROM public.driver_restaurants drr
          JOIN public.restaurants rst ON rst.id = drr.restaurant_id
          WHERE drr.driver_id = dr.id
          ORDER BY rst.name
          LIMIT 1
        ), '—') AS restaurant_name
      FROM public.drivers dr
      LEFT JOIN public.profiles p ON p.id = dr.id
      WHERE dr.archived_at IS NULL
        AND btrim(COALESCE(dr.employee_id, '')) <> ''
    )
    SELECT jsonb_build_object(
      'am', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'mg_id', a.mg_id_raw,
          'work_date', a.work_date,
          'orders', a.orders,
          'rider_name', a.rider_name
        ) ORDER BY a.mg_id, a.work_date)
        FROM am a
      ), '[]'::jsonb),
      'mggo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'mg_id', m.mg_id_raw,
          'work_date', m.work_date,
          'orders', m.orders
        ) ORDER BY m.mg_id, m.work_date)
        FROM mggo m
      ), '[]'::jsonb),
      'riders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'mg_id', r.mg_id_raw,
          'driver_id', r.driver_id,
          'rider_name', r.rider_name,
          'restaurant_name', r.restaurant_name
        ) ORDER BY r.mg_id)
        FROM riders r
        JOIN keys k ON k.mg_id = r.mg_id
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_order_comparison_snapshot(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_order_comparison_snapshot(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_order_comparison_snapshot(date, date) TO authenticated;
