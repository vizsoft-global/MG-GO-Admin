-- Incentive rules v2: base minimum, single/tiered targets, fixed/per-delivery rewards

DO $$ BEGIN
  CREATE TYPE public.incentive_target_mode AS ENUM ('single', 'tiered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.incentive_reward_mode AS ENUM ('fixed', 'per_delivery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.incentive_rules
  ADD COLUMN IF NOT EXISTS target_mode public.incentive_target_mode NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS base_minimum_deliveries int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_mode public.incentive_reward_mode NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS reward_per_delivery_kwd numeric(10, 3);

ALTER TABLE public.incentive_rules
  ALTER COLUMN target_deliveries DROP NOT NULL;

UPDATE public.incentive_rules
SET
  target_mode = 'single',
  base_minimum_deliveries = 0,
  reward_mode = 'fixed'
WHERE target_mode IS NULL OR base_minimum_deliveries IS NULL OR reward_mode IS NULL;

ALTER TABLE public.incentive_rules
  DROP CONSTRAINT IF EXISTS incentive_rules_target_positive;

ALTER TABLE public.incentive_rules
  ADD CONSTRAINT incentive_rules_base_non_negative CHECK (base_minimum_deliveries >= 0);

ALTER TABLE public.incentive_rules
  ADD CONSTRAINT incentive_rules_single_target_check CHECK (
    target_mode <> 'single'
    OR (target_deliveries IS NOT NULL AND target_deliveries > base_minimum_deliveries)
  );

ALTER TABLE public.incentive_rules
  ADD CONSTRAINT incentive_rules_single_reward_check CHECK (
    target_mode <> 'single'
    OR (
      (reward_mode = 'fixed' AND reward_kwd IS NOT NULL AND reward_kwd >= 0)
      OR (
        reward_mode = 'per_delivery'
        AND reward_per_delivery_kwd IS NOT NULL
        AND reward_per_delivery_kwd >= 0
      )
    )
  );

ALTER TABLE public.incentive_rules
  ADD CONSTRAINT incentive_rules_tiered_no_single_target CHECK (
    target_mode <> 'tiered' OR target_deliveries IS NULL
  );

CREATE TABLE IF NOT EXISTS public.incentive_rule_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incentive_rule_id uuid NOT NULL REFERENCES public.incentive_rules(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  threshold_deliveries int NOT NULL,
  reward_mode public.incentive_reward_mode NOT NULL DEFAULT 'fixed',
  reward_kwd numeric(10, 3),
  reward_per_delivery_kwd numeric(10, 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_rule_tiers_threshold_positive CHECK (threshold_deliveries > 0),
  CONSTRAINT incentive_rule_tiers_unique_threshold UNIQUE (incentive_rule_id, threshold_deliveries),
  CONSTRAINT incentive_rule_tiers_reward_check CHECK (
    (reward_mode = 'fixed' AND reward_kwd IS NOT NULL AND reward_kwd >= 0)
    OR (
      reward_mode = 'per_delivery'
      AND reward_per_delivery_kwd IS NOT NULL
      AND reward_per_delivery_kwd >= 0
    )
  )
);

CREATE INDEX IF NOT EXISTS incentive_rule_tiers_rule_sort_idx
  ON public.incentive_rule_tiers (incentive_rule_id, sort_order, threshold_deliveries);

-- Compute payout for one rule + eligible delivery count
CREATE OR REPLACE FUNCTION public.compute_incentive_amount(
  p_rule_id uuid,
  p_eligible_count int
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_base int;
  v_amount numeric(10, 3) := 0;
  v_tier record;
  v_band int;
BEGIN
  IF p_eligible_count IS NULL OR p_eligible_count < 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_base := COALESCE(v_rule.base_minimum_deliveries, 0);
  IF p_eligible_count < v_base THEN
    RETURN 0;
  END IF;

  IF v_rule.target_mode = 'single' THEN
    IF v_rule.target_deliveries IS NULL OR p_eligible_count < v_rule.target_deliveries THEN
      RETURN 0;
    END IF;

    IF v_rule.reward_mode = 'fixed' THEN
      RETURN COALESCE(v_rule.reward_kwd, 0);
    END IF;

    v_band := LEAST(
      p_eligible_count - v_base,
      v_rule.target_deliveries - v_base
    );
    RETURN COALESCE(v_rule.reward_per_delivery_kwd, 0) * GREATEST(v_band, 0);
  END IF;

  FOR v_tier IN
    SELECT *
    FROM public.incentive_rule_tiers t
    WHERE t.incentive_rule_id = p_rule_id
      AND p_eligible_count >= t.threshold_deliveries
    ORDER BY t.threshold_deliveries ASC
  LOOP
    IF v_tier.reward_mode = 'fixed' THEN
      v_amount := v_amount + COALESCE(v_tier.reward_kwd, 0);
    ELSE
      v_band := LEAST(
        p_eligible_count - v_base,
        v_tier.threshold_deliveries - v_base
      );
      v_amount := v_amount + COALESCE(v_tier.reward_per_delivery_kwd, 0) * GREATEST(v_band, 0);
    END IF;
  END LOOP;

  RETURN v_amount;
END;
$$;

-- Recalculate and upsert driver_earnings_daily for one driver + date
CREATE OR REPLACE FUNCTION public.recalculate_driver_earnings(
  p_driver_id uuid,
  p_earn_date date
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
  LOOP
    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.scope_type,
      v_rule.zone_id,
      v_rule.partner_id,
      v_rule.restaurant_id,
      v_rule.period
    );

    v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);
    v_incentive := v_incentive + v_rule_amount;
  END LOOP;

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
    now()
  )
  ON CONFLICT (driver_id, earn_date) DO UPDATE SET
    deliveries = EXCLUDED.deliveries,
    base_kwd = EXCLUDED.base_kwd,
    incentive_kwd = EXCLUDED.incentive_kwd,
    net_kwd = EXCLUDED.net_kwd,
    updated_at = now();
END;
$$;

-- Preview incentives for a date (no writes)
CREATE OR REPLACE FUNCTION public.preview_driver_earnings(p_earn_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_rows jsonb := '[]'::jsonb;
  v_deliveries int;
  v_incentive numeric(10, 3);
  v_rule record;
  v_eligible_count int;
  v_breakdown jsonb;
  v_amount numeric(10, 3);
  v_tier_lines jsonb;
BEGIN
  FOR v_driver IN
    SELECT DISTINCT d.driver_id AS id
    FROM public.deliveries d
    WHERE d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
  LOOP
    v_incentive := 0;
    v_breakdown := '[]'::jsonb;

    SELECT count(*)::int INTO v_deliveries
    FROM public.deliveries d
    WHERE d.driver_id = v_driver.id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
      AND public.delivery_matches_rules(d.id, p_earn_date);

    FOR v_rule IN
      SELECT ir.*
      FROM public.incentive_rules ir
      WHERE ir.status = 'active'
        AND p_earn_date BETWEEN ir.start_date AND ir.end_date
    LOOP
      v_eligible_count := public.count_eligible_deliveries(
        v_driver.id,
        p_earn_date,
        v_rule.scope_type,
        v_rule.zone_id,
        v_rule.partner_id,
        v_rule.restaurant_id,
        v_rule.period
      );

      v_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);
      IF v_amount > 0 THEN
        v_incentive := v_incentive + v_amount;

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
          'reward_kwd', v_amount,
          'amount_kwd', v_amount,
          'tiers', v_tier_lines
        ));
      END IF;
    END LOOP;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'driver_id', v_driver.id,
      'deliveries', v_deliveries,
      'incentive_kwd', v_incentive,
      'rules', v_breakdown
    ));
  END LOOP;

  RETURN jsonb_build_object('earn_date', p_earn_date, 'drivers', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_incentive_amount(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_incentive_amount(uuid, int) TO authenticated;

ALTER TABLE public.incentive_rule_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_incentive_rule_tiers ON public.incentive_rule_tiers;
CREATE POLICY staff_all_incentive_rule_tiers ON public.incentive_rule_tiers
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

COMMENT ON TABLE public.incentive_rule_tiers IS 'Cumulative milestone tiers for tiered incentive rules';
COMMENT ON FUNCTION public.compute_incentive_amount IS 'Payout for one incentive rule given eligible delivery count';
