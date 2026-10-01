-- MGGO Payroll SOP v4.0 — zone efficiency.
--
-- SOP section 6: "Zone efficiency is calculated from the previous completed
-- month only." DPD = zone orders / rider days; Target DPD = the average DPD;
-- Zone efficiency % = DPD / Target DPD * 100, banded Good >= 110,
-- Average >= 70, Low < 70.
--
-- Zone orders are the daily final adjusted orders the Order Reconciliation
-- upload already carries (`order_recon_rows.excel_orders` from the newest
-- applied run per MG ID and Kuwait day) — no second upload, exactly the
-- resolution `admin_order_comparison_snapshot` uses.
--
-- Zone resolution mirrors the SOP: an Americana rider belongs to their
-- restaurant's zone, falling back to their own zone; every other client uses
-- the driver zone.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.payroll_zone_metrics (
  zone_id uuid NOT NULL REFERENCES public.zones (id) ON DELETE CASCADE,
  period_month date NOT NULL,
  orders bigint NOT NULL DEFAULT 0,
  rider_days integer NOT NULL DEFAULT 0,
  /** Zone orders / rider days. Always the computed value, never an override. */
  dpd numeric(12, 4),
  /** Average DPD across zones that had orders. Auto, never an override. */
  target_dpd numeric(12, 4),
  /** Ops override for the zone's own DPD. NULL = use dpd. */
  dpd_used numeric(12, 4),
  /** Ops override for Target DPD. NULL = use target_dpd. */
  target_dpd_used numeric(12, 4),
  efficiency numeric(12, 4),
  category_auto text,
  category_override text,
  good_threshold numeric(6, 2) NOT NULL DEFAULT 110,
  average_threshold numeric(6, 2) NOT NULL DEFAULT 70,
  computed_at timestamptz NOT NULL DEFAULT now(),
  override_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  override_at timestamptz,
  PRIMARY KEY (zone_id, period_month),
  CONSTRAINT payroll_zone_metrics_month_check CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT payroll_zone_metrics_days_check CHECK (rider_days >= 0),
  CONSTRAINT payroll_zone_metrics_category_check CHECK (
    category_auto IS NULL OR category_auto IN ('good', 'average', 'low')
  ),
  CONSTRAINT payroll_zone_metrics_category_override_check CHECK (
    category_override IS NULL OR category_override IN ('good', 'average', 'low')
  )
);

COMMENT ON TABLE public.payroll_zone_metrics IS
  'One row per zone per month: previous-month DPD, target DPD, efficiency, auto category and the Ops overrides.';
COMMENT ON COLUMN public.payroll_zone_metrics.dpd_used IS
  'Ops override for DPD. NULL means the computed dpd is used. Never written by the recompute.';

CREATE INDEX IF NOT EXISTS payroll_zone_metrics_month_idx
  ON public.payroll_zone_metrics (period_month);

ALTER TABLE public.payroll_zone_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_zone_metrics_staff_read ON public.payroll_zone_metrics;
CREATE POLICY payroll_zone_metrics_staff_read ON public.payroll_zone_metrics
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

REVOKE ALL ON public.payroll_zone_metrics FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_zone_metrics FROM authenticated;
GRANT SELECT ON public.payroll_zone_metrics TO authenticated;

-- 1. recompute -----------------------------------------------------------

-- Recomputes orders / rider days / DPD / target DPD / auto category for one
-- month. Deliberately never touches dpd_used, target_dpd_used or
-- category_override: a recompute must not silently discard an Ops decision.
CREATE OR REPLACE FUNCTION public.admin_recompute_payroll_zone_metrics(
  p_month date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_end date;
  v_cur date := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
  v_good numeric(6, 2);
  v_average numeric(6, 2);
  v_target numeric(12, 4);
  v_rows integer := 0;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = 'P0001';
  END IF;
  IF v_month > v_cur OR v_month < (v_cur - INTERVAL '24 months')::date THEN
    RAISE EXCEPTION 'month_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  v_end := (v_month + INTERVAL '1 month')::date;

  SELECT c.good_threshold, c.average_threshold
    INTO v_good, v_average
  FROM public.payroll_clients c
  WHERE c.is_active
  ORDER BY c.uses_zone DESC, c.sort_order, c.key
  LIMIT 1;
  v_good := COALESCE(v_good, 110);
  v_average := COALESCE(v_average, 70);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.payroll_zone_scan (
    zone_id uuid PRIMARY KEY,
    orders bigint NOT NULL,
    rider_days integer NOT NULL
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.payroll_zone_scan;

  INSERT INTO pg_temp.payroll_zone_scan (zone_id, orders, rider_days)
  WITH am_latest AS (
    SELECT DISTINCT ON (lower(btrim(r.employee_id)), r.work_date)
      lower(btrim(r.employee_id)) AS mg_id,
      r.work_date,
      r.run_id
    FROM public.order_recon_rows r
    JOIN public.order_recon_runs ru ON ru.id = r.run_id
    WHERE ru.status = 'applied'
      AND r.work_date >= v_month
      AND r.work_date < v_end
      AND btrim(COALESCE(r.employee_id, '')) <> ''
    ORDER BY lower(btrim(r.employee_id)), r.work_date, ru.created_at DESC
  ),
  am AS (
    SELECT l.mg_id, l.work_date, COALESCE(SUM(r.excel_orders), 0)::bigint AS orders
    FROM am_latest l
    JOIN public.order_recon_rows r
      ON r.run_id = l.run_id
     AND r.work_date = l.work_date
     AND lower(btrim(r.employee_id)) = l.mg_id
    GROUP BY 1, 2
  ),
  driver_zone AS (
    SELECT
      lower(btrim(d.employee_id)) AS mg_id,
      CASE
        WHEN d.project_key = 'americana' THEN COALESCE(rz.zone_id, d.zone_id)
        ELSE d.zone_id
      END AS zone_id
    FROM public.drivers d
    LEFT JOIN LATERAL (
      SELECT rr.zone_id
      FROM public.driver_restaurants dr
      JOIN public.restaurants rr ON rr.id = dr.restaurant_id
      WHERE dr.driver_id = d.id AND rr.zone_id IS NOT NULL
      ORDER BY dr.restaurant_id
      LIMIT 1
    ) rz ON true
    WHERE d.archived_at IS NULL
      AND btrim(COALESCE(d.employee_id, '')) <> ''
  )
  SELECT
    dz.zone_id,
    SUM(a.orders)::bigint,
    COUNT(*)::int
  FROM am a
  JOIN driver_zone dz ON dz.mg_id = a.mg_id
  WHERE a.orders >= 1
    AND dz.zone_id IS NOT NULL
  GROUP BY dz.zone_id;

  SELECT avg(s.orders::numeric / NULLIF(s.rider_days, 0))
    INTO v_target
  FROM pg_temp.payroll_zone_scan s
  WHERE s.rider_days > 0;

  -- First pass inserts the zones that were never computed for this month.
  -- Their overrides cannot exist yet, so the auto figures are the whole story.
  INSERT INTO public.payroll_zone_metrics (
    zone_id, period_month, orders, rider_days, dpd, target_dpd,
    efficiency, category_auto, good_threshold, average_threshold, computed_at
  )
  SELECT
    z.id,
    v_month,
    COALESCE(s.orders, 0),
    COALESCE(s.rider_days, 0),
    CASE WHEN COALESCE(s.rider_days, 0) > 0
      THEN round(s.orders::numeric / s.rider_days, 4) END,
    CASE WHEN v_target IS NULL THEN NULL ELSE round(v_target, 4) END,
    CASE
      WHEN COALESCE(s.rider_days, 0) <= 0 OR COALESCE(v_target, 0) <= 0 THEN NULL
      ELSE round((s.orders::numeric / s.rider_days) / v_target * 100, 4)
    END,
    CASE
      WHEN COALESCE(s.rider_days, 0) <= 0 OR COALESCE(v_target, 0) <= 0 THEN NULL
      WHEN (s.orders::numeric / s.rider_days) / v_target * 100 >= v_good THEN 'good'
      WHEN (s.orders::numeric / s.rider_days) / v_target * 100 >= v_average THEN 'average'
      ELSE 'low'
    END,
    v_good,
    v_average,
    now()
  FROM public.zones z
  LEFT JOIN pg_temp.payroll_zone_scan s ON s.zone_id = z.id
  ON CONFLICT (zone_id, period_month) DO NOTHING;

  -- Second pass refreshes every zone for the month, recomputing efficiency and
  -- the automatic category from whatever overrides already sit on the row, so a
  -- recompute never overrules an Ops decision.
  UPDATE public.payroll_zone_metrics m SET
    orders = COALESCE(s.orders, 0),
    rider_days = COALESCE(s.rider_days, 0),
    dpd = CASE WHEN COALESCE(s.rider_days, 0) > 0
      THEN round(s.orders::numeric / s.rider_days, 4) END,
    target_dpd = CASE WHEN v_target IS NULL THEN NULL ELSE round(v_target, 4) END,
    good_threshold = v_good,
    average_threshold = v_average,
    efficiency = CASE
      WHEN COALESCE(s.rider_days, 0) <= 0 OR COALESCE(m.target_dpd_used, v_target, 0) <= 0 THEN NULL
      ELSE round(
        COALESCE(m.dpd_used, s.orders::numeric / s.rider_days)
          / COALESCE(m.target_dpd_used, v_target) * 100,
        4
      )
    END,
    category_auto = CASE
      WHEN COALESCE(s.rider_days, 0) <= 0 OR COALESCE(m.target_dpd_used, v_target, 0) <= 0 THEN NULL
      WHEN COALESCE(m.dpd_used, s.orders::numeric / s.rider_days)
        / COALESCE(m.target_dpd_used, v_target) * 100 >= v_good THEN 'good'
      WHEN COALESCE(m.dpd_used, s.orders::numeric / s.rider_days)
        / COALESCE(m.target_dpd_used, v_target) * 100 >= v_average THEN 'average'
      ELSE 'low'
    END,
    computed_at = now()
  FROM public.zones z
  LEFT JOIN pg_temp.payroll_zone_scan s ON s.zone_id = z.id
  WHERE z.id = m.zone_id
    AND m.period_month = v_month;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.payroll_log_rule_change(
    NULL, v_month, 'zone_metrics', 'recompute', NULL,
    jsonb_build_object('zones', v_rows, 'targetDpd', v_target)
  );

  RETURN jsonb_build_object(
    'month', v_month,
    'zones', v_rows,
    'targetDpd', v_target,
    'goodThreshold', v_good,
    'averageThreshold', v_average
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recompute_payroll_zone_metrics(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recompute_payroll_zone_metrics(date) TO authenticated, service_role;

-- 2. Ops override --------------------------------------------------------

-- p_dpd_used / p_target_dpd_used / p_category_override are all nullable and
-- NULL means "back to the computed value", which is also the reset path.
CREATE OR REPLACE FUNCTION public.admin_save_payroll_zone_override(
  p_zone_id uuid,
  p_month date,
  p_dpd_used numeric DEFAULT NULL,
  p_target_dpd_used numeric DEFAULT NULL,
  p_category_override text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_category text := NULLIF(lower(btrim(COALESCE(p_category_override, ''))), '');
  v_before jsonb;
  v_row public.payroll_zone_metrics;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = 'P0001';
  END IF;
  IF v_category IS NOT NULL AND v_category NOT IN ('good', 'average', 'low') THEN
    RAISE EXCEPTION 'invalid_zone_category' USING ERRCODE = 'P0001';
  END IF;
  IF p_dpd_used IS NOT NULL AND (p_dpd_used < 0 OR p_dpd_used > 100000) THEN
    RAISE EXCEPTION 'invalid_dpd' USING ERRCODE = 'P0001';
  END IF;
  IF p_target_dpd_used IS NOT NULL AND (p_target_dpd_used < 0 OR p_target_dpd_used > 100000) THEN
    RAISE EXCEPTION 'invalid_target_dpd' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = p_zone_id) THEN
    RAISE EXCEPTION 'unknown_zone' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(m) INTO v_before
  FROM public.payroll_zone_metrics m
  WHERE m.zone_id = p_zone_id AND m.period_month = v_month;

  UPDATE public.payroll_zone_metrics m SET
    dpd_used = p_dpd_used,
    target_dpd_used = p_target_dpd_used,
    category_override = v_category,
    override_by = CASE WHEN p_dpd_used IS NULL
        AND p_target_dpd_used IS NULL
        AND v_category IS NULL THEN NULL ELSE auth.uid() END,
    override_at = CASE WHEN p_dpd_used IS NULL
        AND p_target_dpd_used IS NULL
        AND v_category IS NULL THEN NULL ELSE now() END,
    efficiency = CASE
      WHEN COALESCE(m.rider_days, 0) <= 0 OR COALESCE(m.target_dpd, 0) <= 0 THEN NULL
      ELSE round(
        COALESCE(p_dpd_used, m.dpd) / NULLIF(COALESCE(p_target_dpd_used, m.target_dpd), 0) * 100,
        4
      )
    END,
    category_auto = CASE
      WHEN COALESCE(m.rider_days, 0) <= 0 OR COALESCE(m.target_dpd, 0) <= 0 THEN NULL
      WHEN COALESCE(p_dpd_used, m.dpd) / NULLIF(COALESCE(p_target_dpd_used, m.target_dpd), 0) * 100
        >= m.good_threshold THEN 'good'
      WHEN COALESCE(p_dpd_used, m.dpd) / NULLIF(COALESCE(p_target_dpd_used, m.target_dpd), 0) * 100
        >= m.average_threshold THEN 'average'
      ELSE 'low'
    END
  WHERE m.zone_id = p_zone_id AND m.period_month = v_month
  RETURNING m.* INTO v_row;

  IF v_row.zone_id IS NULL THEN
    RAISE EXCEPTION 'zone_metrics_not_computed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.payroll_log_rule_change(
    NULL, v_month, 'zone_override', 'update', v_before, to_jsonb(v_row)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_payroll_zone_override(uuid, date, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payroll_zone_override(uuid, date, numeric, numeric, text) TO authenticated, service_role;

-- 3. read ----------------------------------------------------------------

-- Rows for the month plus every active zone, so a zone that was never
-- recomputed still appears with a dash instead of vanishing from the panel.
CREATE OR REPLACE FUNCTION public.admin_payroll_zone_metrics(p_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH m AS (
    SELECT date_trunc('month', p_month)::date AS month
  )
  SELECT jsonb_build_object(
    'month', (SELECT month FROM m),
    'zones', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'zoneId', z.id,
          'zoneName', z.name,
          'orders', m.orders,
          'riderDays', m.rider_days,
          'dpd', m.dpd,
          'targetDpd', m.target_dpd,
          'dpdUsed', m.dpd_used,
          'targetDpdUsed', m.target_dpd_used,
          'efficiency', m.efficiency,
          'categoryAuto', m.category_auto,
          'categoryOverride', m.category_override,
          'goodThreshold', m.good_threshold,
          'averageThreshold', m.average_threshold,
          'computedAt', to_char(m.computed_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI'),
          'overrideAt', to_char(m.override_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI')
        )
        ORDER BY z.name
      )
      FROM public.zones z
      LEFT JOIN public.payroll_zone_metrics m
        ON m.zone_id = z.id AND m.period_month = (SELECT month FROM m)
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_zone_metrics(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payroll_zone_metrics(date) TO authenticated, service_role;
