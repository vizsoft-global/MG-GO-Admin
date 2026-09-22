-- Recon app count: logged (pending / in_transit / verified), not Performance's verified-only.
-- cancelled + rejected stay out. under_review is not in this provisional set.
-- Default set is pending client confirm.

CREATE OR REPLACE FUNCTION public.admin_order_recon_compare(
  p_from date,
  p_to date,
  p_excel jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb)
    FROM (
      SELECT
        COALESCE(e.driver_id, a.driver_id) AS driver_id,
        COALESCE(e.restaurant_id, a.restaurant_id) AS restaurant_id,
        COALESCE(e.work_date, a.work_date) AS work_date,
        COALESCE(e.excel_orders, 0) AS excel_orders,
        COALESCE(a.app_orders, 0) AS app_orders,
        COALESCE(a.app_orders, 0) - COALESCE(e.excel_orders, 0) AS difference
      FROM (
        SELECT
          (x->>'driver_id')::uuid AS driver_id,
          (x->>'restaurant_id')::uuid AS restaurant_id,
          (x->>'work_date')::date AS work_date,
          COALESCE((x->>'excel_orders')::integer, 0) AS excel_orders
        FROM jsonb_array_elements(COALESCE(p_excel, '[]'::jsonb)) x
      ) e
      FULL OUTER JOIN (
        SELECT
          d.driver_id,
          d.restaurant_id,
          (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS work_date,
          count(*)::integer AS app_orders
        FROM public.deliveries d
        WHERE d.status IN ('pending', 'in_transit', 'verified')
          AND d.delivered_at IS NOT NULL
          AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN p_from AND p_to
        GROUP BY 1, 2, 3
      ) a
        ON a.driver_id = e.driver_id
       AND a.restaurant_id IS NOT DISTINCT FROM e.restaurant_id
       AND a.work_date = e.work_date
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_order_recon_compare(date, date, jsonb) TO authenticated;
