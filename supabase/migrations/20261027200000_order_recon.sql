CREATE TABLE IF NOT EXISTS public.order_recon_store_aliases (
  alias text PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.order_recon_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES public.profiles(id),
  file_name text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  kpi jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_recon_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.order_recon_runs(id) ON DELETE CASCADE,
  employee_id text,
  employee_name text,
  restaurant_id uuid,
  restaurant_name text,
  driver_id uuid,
  work_date date NOT NULL,
  excel_orders integer NOT NULL DEFAULT 0,
  app_orders integer NOT NULL DEFAULT 0,
  difference integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('match', 'mismatch', 'unresolved', 'app_only'))
);

CREATE INDEX IF NOT EXISTS order_recon_rows_run_idx ON public.order_recon_rows (run_id);

ALTER TABLE public.order_recon_store_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_recon_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_recon_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_order_recon_aliases ON public.order_recon_store_aliases;
CREATE POLICY staff_all_order_recon_aliases ON public.order_recon_store_aliases
  FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_order_recon_runs ON public.order_recon_runs;
CREATE POLICY staff_all_order_recon_runs ON public.order_recon_runs
  FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_order_recon_rows ON public.order_recon_rows;
CREATE POLICY staff_all_order_recon_rows ON public.order_recon_rows
  FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_recon_store_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_recon_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_recon_rows TO authenticated;

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
        WHERE d.status = 'verified'
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
