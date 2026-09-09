-- Overlap replace: matching uses the clamped start. An ended rule stays
-- authoritative for days it originally covered until the replacement's
-- start_date (Kuwait civil). delivery_matches_rules is delivery_rules, not
-- incentive_rules — unchanged.

CREATE OR REPLACE FUNCTION public.incentive_rule_restaurant_ids(p_rule_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT array_agg(DISTINCT rid)
      FROM (
        SELECT ir.restaurant_id AS rid
        FROM public.incentive_rules ir
        WHERE ir.id = p_rule_id
          AND ir.restaurant_id IS NOT NULL
        UNION
        SELECT s.restaurant_id
        FROM public.incentive_rule_scopes s
        WHERE s.incentive_rule_id = p_rule_id
          AND s.restaurant_id IS NOT NULL
      ) x
    ),
    ARRAY[]::uuid[]
  );
$$;

CREATE OR REPLACE FUNCTION public.incentive_rules_share_restaurant(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.incentive_rule_restaurant_ids(p_a)
    && public.incentive_rule_restaurant_ids(p_b);
$$;

CREATE OR REPLACE FUNCTION public.incentive_rule_applies_on_date(
  p_rule_id uuid,
  p_on_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_ids uuid[];
  v_winner uuid;
BEGIN
  IF p_rule_id IS NULL OR p_on_date IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_on_date < v_rule.start_date OR p_on_date > v_rule.end_date THEN
    RETURN false;
  END IF;

  IF v_rule.status = 'active' THEN
    RETURN true;
  END IF;

  IF v_rule.status IS DISTINCT FROM 'ended' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.incentive_rules r2
    WHERE r2.status = 'active'
      AND r2.id IS DISTINCT FROM v_rule.id
      AND p_on_date BETWEEN r2.start_date AND r2.end_date
      AND public.incentive_rules_share_restaurant(v_rule.id, r2.id)
  ) THEN
    RETURN false;
  END IF;

  v_ids := public.incentive_rule_restaurant_ids(v_rule.id);
  IF cardinality(v_ids) = 0 THEN
    RETURN true;
  END IF;

  SELECT ir.id
  INTO v_winner
  FROM public.incentive_rules ir
  WHERE ir.status = 'ended'
    AND p_on_date BETWEEN ir.start_date AND ir.end_date
    AND public.incentive_rule_restaurant_ids(ir.id) && v_ids
    AND NOT EXISTS (
      SELECT 1
      FROM public.incentive_rules r2
      WHERE r2.status = 'active'
        AND p_on_date BETWEEN r2.start_date AND r2.end_date
        AND public.incentive_rules_share_restaurant(ir.id, r2.id)
    )
  ORDER BY ir.priority DESC, ir.created_at DESC, ir.id DESC
  LIMIT 1;

  RETURN v_winner IS NOT DISTINCT FROM v_rule.id;
END;
$$;

REVOKE ALL ON FUNCTION public.incentive_rule_restaurant_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.incentive_rules_share_restaurant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.incentive_rule_applies_on_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incentive_rule_restaurant_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.incentive_rules_share_restaurant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.incentive_rule_applies_on_date(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_driver_incentive_target(
  p_driver_id uuid,
  p_on_date date
)
RETURNS TABLE (
  rule_id uuid,
  period public.incentive_period,
  target_deliveries integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_target integer;
BEGIN
  SELECT ir.*
  INTO v_rule
  FROM public.incentive_rules ir
  WHERE public.incentive_rule_applies_on_date(ir.id, p_on_date)
    AND public.incentive_rule_matches_driver(ir.id, p_driver_id)
  ORDER BY
    CASE WHEN ir.status = 'active' THEN 0 ELSE 1 END,
    ir.priority DESC,
    CASE WHEN ir.status = 'active' THEN ir.created_at END ASC NULLS LAST,
    ir.created_at DESC,
    ir.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_rule.target_mode = 'tiered' THEN
    SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
    INTO v_target
    FROM public.incentive_rule_tiers t
    WHERE t.incentive_rule_id = v_rule.id;
  ELSE
    v_target := COALESCE(v_rule.target_deliveries, 0);
  END IF;

  rule_id := v_rule.id;
  period := v_rule.period;
  target_deliveries := COALESCE(v_target, 0);
  RETURN NEXT;
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
  v_accrues boolean;
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
    WHERE public.incentive_rule_applies_on_date(ir.id, p_earn_date)
    ORDER BY
      CASE WHEN ir.status = 'active' THEN 0 ELSE 1 END,
      ir.priority DESC,
      CASE WHEN ir.status = 'active' THEN ir.created_at END ASC NULLS LAST,
      ir.created_at DESC,
      ir.id DESC
  LOOP
    v_accrues := public.incentive_accrues_on_date(v_rule.period, p_earn_date);

    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.id
    );

    v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);

    IF NOT v_accrues THEN
      v_rule_amount := 0;
    END IF;

    IF v_rule.overrides_others AND v_rule_amount > 0 AND v_rule.priority > v_override_priority THEN
      v_override_amount := v_rule_amount;
      v_override_priority := v_rule.priority;
      v_override_rule_id := v_rule.id;
    END IF;

    IF v_rule_amount > 0 OR (v_accrues AND v_eligible_count > 0) THEN
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
        'accrues_on_date', v_accrues,
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
