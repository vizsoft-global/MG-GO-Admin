-- Payroll v4 — global zone settings, efficiency override, delete client.
-- Additive. Linked project eoksxkdssptgyqyywdju only.

CREATE TABLE IF NOT EXISTS public.payroll_zone_settings (
  period_month date PRIMARY KEY,
  target_dpd_override numeric(12, 4),
  good_threshold numeric(6, 2) NOT NULL DEFAULT 110,
  average_threshold numeric(6, 2) NOT NULL DEFAULT 70,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT payroll_zone_settings_month_check CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT payroll_zone_settings_thresholds CHECK (
    good_threshold >= 0 AND average_threshold >= 0 AND good_threshold >= average_threshold
  )
);

COMMENT ON TABLE public.payroll_zone_settings IS
  'Per-month global Target DPD override and Good/Average efficiency thresholds for zone banding.';

ALTER TABLE public.payroll_zone_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_zone_settings_staff_read ON public.payroll_zone_settings;
CREATE POLICY payroll_zone_settings_staff_read ON public.payroll_zone_settings
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

REVOKE ALL ON public.payroll_zone_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payroll_zone_settings FROM authenticated;
GRANT SELECT ON public.payroll_zone_settings TO authenticated;

ALTER TABLE public.payroll_zone_metrics
  ADD COLUMN IF NOT EXISTS efficiency_override numeric(12, 4);

COMMENT ON COLUMN public.payroll_zone_metrics.efficiency_override IS
  'Ops override for the efficiency the rules and the table use. NULL = use computed efficiency.';

-- Recategorise from the efficiency actually in force and the month's thresholds.
CREATE OR REPLACE FUNCTION public.payroll_zone_band(
  p_efficiency numeric,
  p_good numeric,
  p_average numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_efficiency IS NULL THEN NULL
    WHEN p_efficiency >= COALESCE(p_good, 110) THEN 'good'
    WHEN p_efficiency >= COALESCE(p_average, 70) THEN 'average'
    ELSE 'low'
  END;
$$;

REVOKE ALL ON FUNCTION public.payroll_zone_band(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_zone_band(numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_save_payroll_zone_settings(
  p_month date,
  p_target_dpd_override numeric DEFAULT NULL,
  p_good_threshold numeric DEFAULT 110,
  p_average_threshold numeric DEFAULT 70
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_before jsonb;
  v_row public.payroll_zone_settings;
  v_good numeric(6, 2) := COALESCE(p_good_threshold, 110);
  v_average numeric(6, 2) := COALESCE(p_average_threshold, 70);
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = 'P0001';
  END IF;
  IF v_good < v_average THEN
    RAISE EXCEPTION 'invalid_thresholds' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(s) INTO v_before
  FROM public.payroll_zone_settings s
  WHERE s.period_month = v_month;

  INSERT INTO public.payroll_zone_settings AS s (
    period_month, target_dpd_override, good_threshold, average_threshold, updated_at, updated_by
  ) VALUES (
    v_month, p_target_dpd_override, v_good, v_average, now(), auth.uid()
  )
  ON CONFLICT (period_month) DO UPDATE SET
    target_dpd_override = EXCLUDED.target_dpd_override,
    good_threshold = EXCLUDED.good_threshold,
    average_threshold = EXCLUDED.average_threshold,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING s.* INTO v_row;

  UPDATE public.payroll_zone_metrics m SET
    good_threshold = v_good,
    average_threshold = v_average,
    category_auto = public.payroll_zone_band(
      COALESCE(m.efficiency_override, m.efficiency),
      v_good,
      v_average
    )
  WHERE m.period_month = v_month;

  PERFORM public.payroll_log_rule_change(
    NULL, v_month, 'zone_settings', 'update', v_before, to_jsonb(v_row)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_payroll_zone_settings(date, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payroll_zone_settings(date, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_payroll_zone_settings(p_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH m AS (
    SELECT date_trunc('month', p_month)::date AS month
  ),
  auto AS (
    SELECT avg(z.dpd) FILTER (WHERE z.rider_days > 0) AS auto_target
    FROM public.payroll_zone_metrics z, m
    WHERE z.period_month = m.month
  )
  SELECT jsonb_build_object(
    'periodMonth', to_char((SELECT month FROM m), 'YYYY-MM-DD'),
    'targetDpdOverride', s.target_dpd_override,
    'goodThreshold', COALESCE(s.good_threshold, 110),
    'averageThreshold', COALESCE(s.average_threshold, 70),
    'autoTargetDpd', (SELECT auto_target FROM auto)
  )
  FROM m
  LEFT JOIN public.payroll_zone_settings s ON s.period_month = m.month;
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_zone_settings(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payroll_zone_settings(date) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_save_payroll_zone_override(uuid, date, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.admin_save_payroll_zone_override(
  p_zone_id uuid,
  p_month date,
  p_dpd_used numeric DEFAULT NULL,
  p_target_dpd_used numeric DEFAULT NULL,
  p_category_override text DEFAULT NULL,
  p_efficiency_override numeric DEFAULT NULL
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
  v_good numeric(6, 2);
  v_average numeric(6, 2);
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
  IF p_efficiency_override IS NOT NULL AND (p_efficiency_override < 0 OR p_efficiency_override > 1000) THEN
    RAISE EXCEPTION 'invalid_efficiency' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zones z WHERE z.id = p_zone_id) THEN
    RAISE EXCEPTION 'unknown_zone' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(s.good_threshold, m.good_threshold, 110),
         COALESCE(s.average_threshold, m.average_threshold, 70)
    INTO v_good, v_average
  FROM public.payroll_zone_metrics m
  LEFT JOIN public.payroll_zone_settings s ON s.period_month = v_month
  WHERE m.zone_id = p_zone_id AND m.period_month = v_month;

  SELECT to_jsonb(m) INTO v_before
  FROM public.payroll_zone_metrics m
  WHERE m.zone_id = p_zone_id AND m.period_month = v_month;

  UPDATE public.payroll_zone_metrics m SET
    dpd_used = p_dpd_used,
    target_dpd_used = p_target_dpd_used,
    efficiency_override = p_efficiency_override,
    category_override = v_category,
    override_by = CASE WHEN p_dpd_used IS NULL
        AND p_target_dpd_used IS NULL
        AND p_efficiency_override IS NULL
        AND v_category IS NULL THEN NULL ELSE auth.uid() END,
    override_at = CASE WHEN p_dpd_used IS NULL
        AND p_target_dpd_used IS NULL
        AND p_efficiency_override IS NULL
        AND v_category IS NULL THEN NULL ELSE now() END,
    efficiency = CASE
      WHEN COALESCE(m.rider_days, 0) <= 0 OR COALESCE(m.target_dpd, 0) <= 0 THEN NULL
      ELSE round(
        COALESCE(p_dpd_used, m.dpd) / NULLIF(COALESCE(p_target_dpd_used, m.target_dpd), 0) * 100,
        4
      )
    END,
    category_auto = public.payroll_zone_band(
      COALESCE(
        p_efficiency_override,
        CASE
          WHEN COALESCE(m.rider_days, 0) <= 0 OR COALESCE(m.target_dpd, 0) <= 0 THEN NULL
          ELSE round(
            COALESCE(p_dpd_used, m.dpd) / NULLIF(COALESCE(p_target_dpd_used, m.target_dpd), 0) * 100,
            4
          )
        END
      ),
      COALESCE(v_good, 110),
      COALESCE(v_average, 70)
    )
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

REVOKE ALL ON FUNCTION public.admin_save_payroll_zone_override(uuid, date, numeric, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payroll_zone_override(uuid, date, numeric, numeric, text, numeric) TO authenticated, service_role;

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
          'efficiencyOverride', m.efficiency_override,
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

CREATE OR REPLACE FUNCTION public.admin_delete_payroll_client(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(COALESCE(p_key, '')));
  v_before jsonb;
  v_riders integer;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'unknown_client' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(c) INTO v_before
  FROM public.payroll_clients c
  WHERE c.key = v_key;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'unknown_client' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE((v_before ->> 'is_system')::boolean, false) THEN
    RAISE EXCEPTION 'system_client' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_riders
  FROM public.drivers d
  WHERE d.project_key = v_key;

  IF v_riders > 0 THEN
    RAISE EXCEPTION 'client_has_riders' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.driver_intakes i WHERE i.project_key = v_key) THEN
    RAISE EXCEPTION 'client_has_riders' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.payroll_clients c WHERE c.key = v_key;

  PERFORM public.payroll_log_rule_change(
    v_key, date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date,
    'client', 'delete', v_before, NULL
  );

  RETURN jsonb_build_object('ok', true, 'key', v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_payroll_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_payroll_client(text) TO authenticated, service_role;
