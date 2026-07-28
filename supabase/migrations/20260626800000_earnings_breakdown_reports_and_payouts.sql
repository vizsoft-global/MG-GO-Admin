-- Earnings breakdown snapshots, grouped reporting RPCs, and payout runs.

DO $$ BEGIN
  CREATE TYPE public.payout_run_status AS ENUM (
    'draft',
    'approved',
    'paid',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.driver_earnings_daily
  ADD COLUMN IF NOT EXISTS breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz;

UPDATE public.driver_earnings_daily
SET calculated_at = COALESCE(calculated_at, updated_at, created_at)
WHERE calculated_at IS NULL;

DROP POLICY IF EXISTS driver_read_own_earnings_daily ON public.driver_earnings_daily;
CREATE POLICY driver_read_own_earnings_daily ON public.driver_earnings_daily
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.payout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status public.payout_run_status NOT NULL DEFAULT 'draft',
  notes text,
  total_drivers int NOT NULL DEFAULT 0,
  total_payable_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  paid_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_runs_period_chk CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payout_runs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  base_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  incentive_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  loan_deduction_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  penalty_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  reimbursement_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  adjustment_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  net_payable_kwd numeric(12, 3) NOT NULL DEFAULT 0,
  delivery_count int NOT NULL DEFAULT 0,
  breakdown_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.payout_run_status NOT NULL DEFAULT 'draft',
  notes text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_payouts_period_chk CHECK (period_end >= period_start),
  CONSTRAINT driver_payouts_run_driver_unique UNIQUE (run_id, driver_id)
);

CREATE INDEX IF NOT EXISTS payout_runs_period_idx
  ON public.payout_runs (period_start, period_end, status);
CREATE INDEX IF NOT EXISTS driver_payouts_driver_period_idx
  ON public.driver_payouts (driver_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS driver_payouts_run_idx
  ON public.driver_payouts (run_id, status);

ALTER TABLE public.payout_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_payout_runs ON public.payout_runs;
CREATE POLICY staff_all_payout_runs ON public.payout_runs
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_all_driver_payouts ON public.driver_payouts;
CREATE POLICY staff_all_driver_payouts ON public.driver_payouts
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_read_own_payouts ON public.driver_payouts;
CREATE POLICY driver_read_own_payouts ON public.driver_payouts
  FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    AND status IN ('approved', 'paid')
  );

CREATE OR REPLACE FUNCTION public.sync_driver_wallet_earning_credit(
  p_driver_id uuid,
  p_earn_date date,
  p_approved_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.driver_earnings_daily%ROWTYPE;
  v_source_ref text;
BEGIN
  SELECT * INTO v_row
  FROM public.driver_earnings_daily
  WHERE driver_id = p_driver_id AND earn_date = p_earn_date;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_source_ref := 'earning:' || p_driver_id::text || ':' || p_earn_date::text;

  INSERT INTO public.driver_wallet_entries (
    driver_id,
    earn_date,
    entry_type,
    amount_kwd,
    status,
    source_ref,
    approved_at,
    approved_by,
    meta,
    updated_at
  )
  VALUES (
    p_driver_id,
    p_earn_date,
    'earning_credit',
    GREATEST(v_row.net_kwd, 0),
    'approved',
    v_source_ref,
    now(),
    p_approved_by,
    jsonb_build_object(
      'deliveries', v_row.deliveries,
      'base_kwd', v_row.base_kwd,
      'incentive_kwd', v_row.incentive_kwd,
      'loan_deduction_kwd', v_row.loan_deduction_kwd,
      'penalty_kwd', v_row.penalty_kwd,
      'reimbursement_kwd', v_row.reimbursement_kwd,
      'net_kwd', v_row.net_kwd,
      'breakdown', COALESCE(v_row.breakdown, '[]'::jsonb)
    ),
    now()
  )
  ON CONFLICT (source_ref) DO UPDATE SET
    amount_kwd = EXCLUDED.amount_kwd,
    status = 'approved',
    approved_at = EXCLUDED.approved_at,
    approved_by = COALESCE(EXCLUDED.approved_by, public.driver_wallet_entries.approved_by),
    meta = EXCLUDED.meta,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_driver_earnings(
  p_driver_id uuid,
  p_earn_date date,
  p_approved_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deliveries int;
  v_incentive numeric(10, 3) := 0;
  v_base numeric(10, 3) := 0;
  v_loan numeric(10, 3) := 0;
  v_penalty numeric(10, 3) := 0;
  v_reimb numeric(10, 3) := 0;
  v_net numeric(10, 3);
  v_rule record;
  v_eligible_count int;
  v_existing record;
  v_rule_amount numeric(10, 3);
  v_override_amount numeric(10, 3) := -1;
  v_override_priority int := -1;
  v_override_rule_id uuid;
  v_breakdown jsonb := '[]'::jsonb;
  v_tier_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(base_earnings_kwd, 0) INTO v_base
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT deliveries, loan_deduction_kwd, penalty_kwd, reimbursement_kwd
  INTO v_existing
  FROM public.driver_earnings_daily
  WHERE driver_id = p_driver_id AND earn_date = p_earn_date;

  IF FOUND THEN
    v_loan := COALESCE(v_existing.loan_deduction_kwd, 0);
    v_penalty := COALESCE(v_existing.penalty_kwd, 0);
    v_reimb := COALESCE(v_existing.reimbursement_kwd, 0);
  END IF;

  SELECT count(*)::int INTO v_deliveries
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
    AND public.delivery_matches_rules(d.id, p_earn_date);

  FOR v_rule IN
    SELECT ir.*
    FROM public.incentive_rules ir
    WHERE ir.status = 'active'
      AND p_earn_date BETWEEN ir.start_date AND ir.end_date
    ORDER BY ir.priority DESC, ir.created_at ASC
  LOOP
    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.id
    );

    v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);

    IF v_rule.overrides_others AND v_rule_amount > 0 AND v_rule.priority > v_override_priority THEN
      v_override_amount := v_rule_amount;
      v_override_priority := v_rule.priority;
      v_override_rule_id := v_rule.id;
    END IF;

    IF v_rule_amount > 0 THEN
      v_tier_lines := '[]'::jsonb;
      IF v_rule.target_mode = 'tiered' THEN
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'threshold', t.threshold_deliveries,
              'reward_mode', t.reward_mode,
              'met', v_eligible_count >= t.threshold_deliveries
            )
            ORDER BY t.threshold_deliveries
          ),
          '[]'::jsonb
        )
        INTO v_tier_lines
        FROM public.incentive_rule_tiers t
        WHERE t.incentive_rule_id = v_rule.id;
      END IF;

      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.name,
        'period', v_rule.period,
        'eligible_count', v_eligible_count,
        'target_mode', v_rule.target_mode,
        'base_minimum', v_rule.base_minimum_deliveries,
        'target', v_rule.target_deliveries,
        'reward_mode', v_rule.reward_mode,
        'payout_mode', v_rule.payout_mode,
        'overrides_others', v_rule.overrides_others,
        'priority', v_rule.priority,
        'amount_kwd', v_rule_amount,
        'tiers', v_tier_lines
      ));
    END IF;

    v_incentive := v_incentive + v_rule_amount;
  END LOOP;

  IF v_override_amount >= 0 THEN
    v_incentive := v_override_amount;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'override_rule_id', v_override_rule_id,
      'note', 'override_applied',
      'final_incentive_kwd', v_override_amount
    ));
  END IF;

  v_net := v_base + v_incentive - v_loan - v_penalty + v_reimb;

  INSERT INTO public.driver_earnings_daily (
    driver_id,
    earn_date,
    deliveries,
    base_kwd,
    incentive_kwd,
    loan_deduction_kwd,
    penalty_kwd,
    reimbursement_kwd,
    net_kwd,
    breakdown,
    calculated_at,
    updated_at
  )
  VALUES (
    p_driver_id,
    p_earn_date,
    v_deliveries,
    v_base,
    v_incentive,
    v_loan,
    v_penalty,
    v_reimb,
    v_net,
    COALESCE(v_breakdown, '[]'::jsonb),
    now(),
    now()
  )
  ON CONFLICT (driver_id, earn_date) DO UPDATE SET
    deliveries = EXCLUDED.deliveries,
    base_kwd = EXCLUDED.base_kwd,
    incentive_kwd = EXCLUDED.incentive_kwd,
    net_kwd = EXCLUDED.net_kwd,
    breakdown = EXCLUDED.breakdown,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  PERFORM public.sync_driver_wallet_earning_credit(p_driver_id, p_earn_date, p_approved_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_earnings_overview(
  p_start_date date,
  p_end_date date,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_ids uuid[];
  v_zone_ids uuid[];
  v_partner_ids uuid[];
  v_restaurant_ids uuid[];
  v_kpis jsonb;
  v_top_zone jsonb;
  v_top_partner jsonb;
  v_top_restaurant jsonb;
BEGIN
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_driver_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'driver_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_zone_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'zone_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_partner_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'partner_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_restaurant_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'restaurant_ids', '[]'::jsonb));

  WITH filtered AS (
    SELECT e.*
    FROM public.driver_earnings_daily e
    WHERE e.earn_date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR e.driver_id = ANY(v_driver_ids))
      AND (
        (cardinality(v_zone_ids) = 0 AND cardinality(v_partner_ids) = 0 AND cardinality(v_restaurant_ids) = 0)
        OR EXISTS (
          SELECT 1
          FROM public.deliveries d
          WHERE d.driver_id = e.driver_id
            AND d.status = 'verified'
            AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = e.earn_date
            AND (cardinality(v_zone_ids) = 0 OR d.zone_id = ANY(v_zone_ids))
            AND (cardinality(v_partner_ids) = 0 OR d.partner_id = ANY(v_partner_ids))
            AND (cardinality(v_restaurant_ids) = 0 OR d.restaurant_id = ANY(v_restaurant_ids))
        )
      )
  )
  SELECT jsonb_build_object(
    'total_payable_kwd', COALESCE(sum(net_kwd), 0),
    'total_incentive_kwd', COALESCE(sum(incentive_kwd), 0),
    'total_deliveries', COALESCE(sum(deliveries), 0),
    'active_drivers', COALESCE(count(DISTINCT driver_id), 0),
    'calculated_rows', COALESCE(count(*), 0),
    'latest_calculated_at', max(calculated_at)
  )
  INTO v_kpis
  FROM filtered;

  WITH d AS (
    SELECT z.id, z.name, count(*)::int AS deliveries
    FROM public.deliveries del
    JOIN public.zones z ON z.id = del.zone_id
    WHERE del.status = 'verified'
      AND (del.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR del.driver_id = ANY(v_driver_ids))
      AND (cardinality(v_zone_ids) = 0 OR del.zone_id = ANY(v_zone_ids))
      AND (cardinality(v_partner_ids) = 0 OR del.partner_id = ANY(v_partner_ids))
      AND (cardinality(v_restaurant_ids) = 0 OR del.restaurant_id = ANY(v_restaurant_ids))
    GROUP BY z.id, z.name
    ORDER BY deliveries DESC, z.name
    LIMIT 1
  )
  SELECT COALESCE(to_jsonb(d), '{}'::jsonb) INTO v_top_zone FROM d;

  WITH d AS (
    SELECT p.id, p.name, count(*)::int AS deliveries
    FROM public.deliveries del
    JOIN public.partners p ON p.id = del.partner_id
    WHERE del.status = 'verified'
      AND (del.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR del.driver_id = ANY(v_driver_ids))
      AND (cardinality(v_zone_ids) = 0 OR del.zone_id = ANY(v_zone_ids))
      AND (cardinality(v_partner_ids) = 0 OR del.partner_id = ANY(v_partner_ids))
      AND (cardinality(v_restaurant_ids) = 0 OR del.restaurant_id = ANY(v_restaurant_ids))
    GROUP BY p.id, p.name
    ORDER BY deliveries DESC, p.name
    LIMIT 1
  )
  SELECT COALESCE(to_jsonb(d), '{}'::jsonb) INTO v_top_partner FROM d;

  WITH d AS (
    SELECT r.id, r.name, count(*)::int AS deliveries
    FROM public.deliveries del
    JOIN public.restaurants r ON r.id = del.restaurant_id
    WHERE del.status = 'verified'
      AND (del.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR del.driver_id = ANY(v_driver_ids))
      AND (cardinality(v_zone_ids) = 0 OR del.zone_id = ANY(v_zone_ids))
      AND (cardinality(v_partner_ids) = 0 OR del.partner_id = ANY(v_partner_ids))
      AND (cardinality(v_restaurant_ids) = 0 OR del.restaurant_id = ANY(v_restaurant_ids))
    GROUP BY r.id, r.name
    ORDER BY deliveries DESC, r.name
    LIMIT 1
  )
  SELECT COALESCE(to_jsonb(d), '{}'::jsonb) INTO v_top_restaurant FROM d;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'kpis', COALESCE(v_kpis, '{}'::jsonb),
    'top_zone', v_top_zone,
    'top_partner', v_top_partner,
    'top_restaurant', v_top_restaurant
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_earnings_grouped(
  p_start_date date,
  p_end_date date,
  p_group_by text,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_ids uuid[];
  v_zone_ids uuid[];
  v_partner_ids uuid[];
  v_restaurant_ids uuid[];
  v_rows jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_driver_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'driver_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_zone_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'zone_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_partner_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'partner_ids', '[]'::jsonb));
  SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
  INTO v_restaurant_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'restaurant_ids', '[]'::jsonb));

  IF p_group_by = 'day' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'group_type', 'day',
          'group_id', e.earn_date::text,
          'group_name', e.earn_date::text,
          'delivery_count', sum(e.deliveries),
          'driver_count', count(DISTINCT e.driver_id),
          'incentive_kwd', sum(e.incentive_kwd),
          'net_kwd', sum(e.net_kwd)
        )
        ORDER BY e.earn_date DESC
      ),
      '[]'::jsonb
    )
    INTO v_rows
    FROM public.driver_earnings_daily e
    WHERE e.earn_date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR e.driver_id = ANY(v_driver_ids))
    GROUP BY e.earn_date;
  ELSIF p_group_by = 'driver' THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'group_type', 'driver',
          'group_id', e.driver_id,
          'group_name', COALESCE(pr.full_name, dr.driver_code, '—'),
          'driver_code', dr.driver_code,
          'delivery_count', sum(e.deliveries),
          'days_count', count(*),
          'incentive_kwd', sum(e.incentive_kwd),
          'net_kwd', sum(e.net_kwd)
        )
        ORDER BY sum(e.net_kwd) DESC, COALESCE(pr.full_name, dr.driver_code, '—')
      ),
      '[]'::jsonb
    )
    INTO v_rows
    FROM public.driver_earnings_daily e
    JOIN public.drivers dr ON dr.id = e.driver_id
    LEFT JOIN public.profiles pr ON pr.id = e.driver_id
    WHERE e.earn_date BETWEEN p_start_date AND p_end_date
      AND (cardinality(v_driver_ids) = 0 OR e.driver_id = ANY(v_driver_ids))
    GROUP BY e.driver_id, dr.driver_code, pr.full_name;
  ELSIF p_group_by IN ('zone', 'partner', 'restaurant') THEN
    WITH filtered AS (
      SELECT e.driver_id, e.earn_date, e.incentive_kwd, e.net_kwd
      FROM public.driver_earnings_daily e
      WHERE e.earn_date BETWEEN p_start_date AND p_end_date
        AND (cardinality(v_driver_ids) = 0 OR e.driver_id = ANY(v_driver_ids))
    ),
    deliveries_on_day AS (
      SELECT
        d.id,
        d.driver_id,
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS earn_date,
        d.zone_id,
        z.name AS zone_name,
        d.partner_id,
        p.name AS partner_name,
        d.restaurant_id,
        r.name AS restaurant_name
      FROM public.deliveries d
      LEFT JOIN public.zones z ON z.id = d.zone_id
      LEFT JOIN public.partners p ON p.id = d.partner_id
      LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
      WHERE d.status = 'verified'
        AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN p_start_date AND p_end_date
        AND (cardinality(v_driver_ids) = 0 OR d.driver_id = ANY(v_driver_ids))
        AND (cardinality(v_zone_ids) = 0 OR d.zone_id = ANY(v_zone_ids))
        AND (cardinality(v_partner_ids) = 0 OR d.partner_id = ANY(v_partner_ids))
        AND (cardinality(v_restaurant_ids) = 0 OR d.restaurant_id = ANY(v_restaurant_ids))
    ),
    totals AS (
      SELECT driver_id, earn_date, count(*)::numeric AS total_deliveries
      FROM deliveries_on_day
      GROUP BY driver_id, earn_date
    ),
    grouped AS (
      SELECT
        CASE
          WHEN p_group_by = 'zone' THEN d.zone_id::text
          WHEN p_group_by = 'partner' THEN d.partner_id::text
          ELSE d.restaurant_id::text
        END AS group_id,
        CASE
          WHEN p_group_by = 'zone' THEN COALESCE(d.zone_name, 'Unassigned')
          WHEN p_group_by = 'partner' THEN COALESCE(d.partner_name, 'Unassigned')
          ELSE COALESCE(d.restaurant_name, 'Unassigned')
        END AS group_name,
        count(*)::int AS delivery_count,
        count(DISTINCT d.driver_id) AS driver_count,
        sum(f.incentive_kwd / NULLIF(t.total_deliveries, 0)) AS incentive_kwd,
        sum(f.net_kwd / NULLIF(t.total_deliveries, 0)) AS net_kwd
      FROM deliveries_on_day d
      JOIN totals t ON t.driver_id = d.driver_id AND t.earn_date = d.earn_date
      JOIN filtered f ON f.driver_id = d.driver_id AND f.earn_date = d.earn_date
      GROUP BY 1, 2
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'group_type', p_group_by,
          'group_id', group_id,
          'group_name', group_name,
          'delivery_count', delivery_count,
          'driver_count', driver_count,
          'incentive_kwd', COALESCE(incentive_kwd, 0),
          'net_kwd', COALESCE(net_kwd, 0)
        )
        ORDER BY net_kwd DESC, group_name
      ),
      '[]'::jsonb
    )
    INTO v_rows
    FROM grouped;
  ELSE
    RAISE EXCEPTION 'invalid_group_by';
  END IF;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'group_by', p_group_by,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_payout_run(
  p_period_start date,
  p_period_end date,
  p_driver_ids uuid[] DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.driver_payouts dp
    JOIN public.payout_runs pr ON pr.id = dp.run_id
    WHERE pr.status <> 'voided'
      AND dp.period_start <= p_period_end
      AND dp.period_end >= p_period_start
      AND (
        p_driver_ids IS NULL
        OR cardinality(p_driver_ids) = 0
        OR dp.driver_id = ANY(p_driver_ids)
      )
  ) THEN
    RAISE EXCEPTION 'payout_overlap_exists';
  END IF;

  INSERT INTO public.payout_runs (
    period_start,
    period_end,
    status,
    notes,
    created_by
  )
  VALUES (
    p_period_start,
    p_period_end,
    'draft',
    NULLIF(trim(p_notes), ''),
    v_actor
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.driver_payouts (
    run_id,
    driver_id,
    period_start,
    period_end,
    base_kwd,
    incentive_kwd,
    loan_deduction_kwd,
    penalty_kwd,
    reimbursement_kwd,
    adjustment_kwd,
    net_payable_kwd,
    delivery_count,
    breakdown_snapshot,
    status
  )
  SELECT
    v_run_id,
    e.driver_id,
    p_period_start,
    p_period_end,
    sum(e.base_kwd),
    sum(e.incentive_kwd),
    sum(e.loan_deduction_kwd),
    sum(e.penalty_kwd),
    sum(e.reimbursement_kwd),
    0::numeric(12, 3),
    sum(e.base_kwd + e.incentive_kwd - e.loan_deduction_kwd - e.penalty_kwd + e.reimbursement_kwd),
    sum(e.deliveries),
    COALESCE(
      (
        SELECT jsonb_agg(elem)
        FROM (
          SELECT jsonb_array_elements(e2.breakdown) AS elem
          FROM public.driver_earnings_daily e2
          WHERE e2.driver_id = e.driver_id
            AND e2.earn_date BETWEEN p_period_start AND p_period_end
        ) x
      ),
      '[]'::jsonb
    ),
    'draft'
  FROM public.driver_earnings_daily e
  WHERE e.earn_date BETWEEN p_period_start AND p_period_end
    AND (
      p_driver_ids IS NULL
      OR cardinality(p_driver_ids) = 0
      OR e.driver_id = ANY(p_driver_ids)
    )
  GROUP BY e.driver_id;

  UPDATE public.payout_runs pr
  SET
    total_drivers = COALESCE((
      SELECT count(*)::int
      FROM public.driver_payouts dp
      WHERE dp.run_id = pr.id
    ), 0),
    total_payable_kwd = COALESCE((
      SELECT sum(dp.net_payable_kwd)
      FROM public.driver_payouts dp
      WHERE dp.run_id = pr.id
    ), 0),
    updated_at = now()
  WHERE pr.id = v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_payout_run(
  p_run_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_status public.payout_run_status;
BEGIN
  SELECT status INTO v_status
  FROM public.payout_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_found';
  END IF;

  IF v_status = 'voided' THEN
    RAISE EXCEPTION 'run_voided';
  END IF;

  UPDATE public.payout_runs
  SET
    status = 'approved',
    approved_at = now(),
    approved_by = COALESCE(v_actor, approved_by),
    updated_at = now()
  WHERE id = p_run_id;

  UPDATE public.driver_payouts
  SET
    status = 'approved',
    updated_at = now()
  WHERE run_id = p_run_id;

  INSERT INTO public.driver_wallet_entries (
    driver_id,
    earn_date,
    entry_type,
    amount_kwd,
    status,
    source_ref,
    approved_at,
    approved_by,
    meta,
    updated_at
  )
  SELECT
    dp.driver_id,
    dp.period_end,
    'payout_debit',
    GREATEST(dp.net_payable_kwd + COALESCE(dp.adjustment_kwd, 0), 0),
    'approved',
    'payout:' || dp.run_id::text || ':' || dp.driver_id::text,
    now(),
    v_actor,
    jsonb_build_object(
      'run_id', dp.run_id,
      'period_start', dp.period_start,
      'period_end', dp.period_end,
      'delivery_count', dp.delivery_count,
      'net_payable_kwd', dp.net_payable_kwd,
      'adjustment_kwd', dp.adjustment_kwd
    ),
    now()
  FROM public.driver_payouts dp
  WHERE dp.run_id = p_run_id
  ON CONFLICT (source_ref) DO UPDATE SET
    amount_kwd = EXCLUDED.amount_kwd,
    status = 'approved',
    approved_at = EXCLUDED.approved_at,
    approved_by = COALESCE(EXCLUDED.approved_by, public.driver_wallet_entries.approved_by),
    meta = EXCLUDED.meta,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payout_run_paid(
  p_run_id uuid,
  p_paid_at timestamptz DEFAULT now(),
  p_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  UPDATE public.payout_runs
  SET
    status = 'paid',
    paid_at = COALESCE(p_paid_at, now()),
    paid_by = COALESCE(v_actor, paid_by),
    notes = CASE
      WHEN p_reference IS NULL OR trim(p_reference) = '' THEN notes
      ELSE concat_ws(E'\n', notes, 'reference: ' || trim(p_reference))
    END,
    updated_at = now()
  WHERE id = p_run_id
    AND status IN ('approved', 'paid');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_approved';
  END IF;

  UPDATE public.driver_payouts
  SET
    status = 'paid',
    paid_at = COALESCE(p_paid_at, now()),
    updated_at = now()
  WHERE run_id = p_run_id
    AND status IN ('approved', 'paid');
END;
$$;

CREATE OR REPLACE FUNCTION public.void_payout_run(
  p_run_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payout_runs
  SET
    status = 'voided',
    notes = CASE
      WHEN p_reason IS NULL OR trim(p_reason) = '' THEN notes
      ELSE concat_ws(E'\n', notes, 'void_reason: ' || trim(p_reason))
    END,
    updated_at = now()
  WHERE id = p_run_id
    AND status <> 'voided';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.driver_payouts
  SET
    status = 'voided',
    updated_at = now()
  WHERE run_id = p_run_id;

  UPDATE public.driver_wallet_entries
  SET
    status = 'voided',
    updated_at = now()
  WHERE entry_type = 'payout_debit'
    AND source_ref LIKE ('payout:' || p_run_id::text || ':%');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_payout_run_detail(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run jsonb;
  v_lines jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id,
    'period_start', r.period_start,
    'period_end', r.period_end,
    'status', r.status,
    'notes', r.notes,
    'total_drivers', r.total_drivers,
    'total_payable_kwd', r.total_payable_kwd,
    'created_by', r.created_by,
    'approved_by', r.approved_by,
    'paid_by', r.paid_by,
    'created_at', r.created_at,
    'approved_at', r.approved_at,
    'paid_at', r.paid_at
  )
  INTO v_run
  FROM public.payout_runs r
  WHERE r.id = p_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'run_not_found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', dp.id,
        'driver_id', dp.driver_id,
        'driver_code', dr.driver_code,
        'driver_name', COALESCE(pr.full_name, '—'),
        'period_start', dp.period_start,
        'period_end', dp.period_end,
        'base_kwd', dp.base_kwd,
        'incentive_kwd', dp.incentive_kwd,
        'loan_deduction_kwd', dp.loan_deduction_kwd,
        'penalty_kwd', dp.penalty_kwd,
        'reimbursement_kwd', dp.reimbursement_kwd,
        'adjustment_kwd', dp.adjustment_kwd,
        'net_payable_kwd', dp.net_payable_kwd,
        'delivery_count', dp.delivery_count,
        'status', dp.status,
        'notes', dp.notes,
        'paid_at', dp.paid_at,
        'breakdown_snapshot', dp.breakdown_snapshot
      )
      ORDER BY COALESCE(pr.full_name, dr.driver_code)
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM public.driver_payouts dp
  JOIN public.drivers dr ON dr.id = dp.driver_id
  LEFT JOIN public.profiles pr ON pr.id = dp.driver_id
  WHERE dp.run_id = p_run_id;

  RETURN jsonb_build_object(
    'run', v_run,
    'lines', v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_earnings_overview(date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_earnings_grouped(date, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payout_run(date, date, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payout_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_run_paid(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_payout_run(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payout_run_detail(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_earnings_overview(date, date, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_earnings_grouped(date, date, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_payout_run(date, date, uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_payout_run(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payout_run_paid(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_payout_run(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_run_detail(uuid) TO service_role;
