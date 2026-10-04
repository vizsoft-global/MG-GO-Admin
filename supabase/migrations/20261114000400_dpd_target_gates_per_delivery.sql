-- Daily DPD target GATES every per-delivery payout (QA #51, confirmed decision
-- = option A).
--
-- Before this migration the band math built by
-- 20261028700000_rider_daily_dpd_target.sql only honoured a restaurant
-- delivery_rules.dpd_target when that target sat BELOW the rule's first tier
-- threshold, and only for tiered rules whose tiers were all per-delivery. So:
--
--   * a rule whose target was at/above the first threshold fell back to the
--     synthetic band start (or the rule base) and paid a rider BELOW the
--     target, and
--   * a fixed / single-target / "Override other rules" rule was never gated at
--     all, because the band path does not apply to it.
--
-- Option A: a rule that carries a DPD target stays locked until the target is
-- reached, regardless of reward_mode, payout_mode or overrides_others.
--
-- The gate lives in compute_incentive_amount because that is the single place
-- every payout path (band math, milestone stacking, cumulative, and the
-- overrides_others rule) is priced. The band start keeps its job of saying
-- where the per-order bands begin, and now uses the same resolved target:
-- GREATEST(target, rule base) so a low target cannot undercut the rule's own
-- base floor and the base stays the fallback when no target resolves.
--
-- Cutover guard: the target only gates on/after
-- app_settings.incentive_band_math_from, so recalculating a day that was paid
-- under the legacy math never rewrites it (same rule 20261028700000 set for
-- the band math itself).
--
-- Recalc note: existing driver_earnings_daily rows are NOT rewritten by this
-- migration. A day where the rider was below the target but the legacy math
-- still paid will keep its stored incentive_kwd until it is recalculated, e.g.
--
--   select public.recalculate_driver_earnings(d.id, e.earn_date)
--   from public.driver_earnings_daily e
--   join public.drivers d on d.id = e.driver_id
--   where e.earn_date >= (select incentive_band_math_from from public.app_settings
--                         order by updated_at desc nulls last limit 1);
--
-- or the whole day with select public.recalculate_earnings_for_date(<date>).

-- ---------------------------------------------------------------------------
-- Resolved daily DPD target for a rule on a date (NULL = no target = no gate)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._incentive_rule_dpd_target(
  p_rule_id uuid,
  p_on_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
  v_target int;
BEGIN
  IF p_rule_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- No target gate before the band-math cutover.
  SELECT incentive_band_math_from INTO v_from
  FROM public.app_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
  IF v_from IS NULL OR p_on_date < v_from THEN
    RETURN NULL;
  END IF;

  -- Same restaurant -> zone resolution as _incentive_band_start /
  -- admin_dpd_efficiency_snapshot. The highest target wins, so a rule that
  -- spans restaurants is gated by the strictest one.
  SELECT x.target INTO v_target
  FROM unnest(public.incentive_rule_restaurant_ids(p_rule_id)) AS rid
  CROSS JOIN LATERAL (
    SELECT public._restaurant_daily_dpd_target(rid, p_on_date) AS target
  ) x
  WHERE x.target > 0
  ORDER BY x.target DESC
  LIMIT 1;

  RETURN v_target;
END;
$$;

-- ---------------------------------------------------------------------------
-- Band start: the target is the gate, the rule base is the floor / fallback
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._incentive_band_start(
  p_rule_id uuid,
  p_on_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_first int;
  v_second int;
  v_target int;
BEGIN
  IF p_rule_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND OR v_rule.target_mode IS DISTINCT FROM 'tiered' THEN
    RETURN NULL;
  END IF;

  -- Band math only makes sense when every tier pays per delivery.
  IF NOT EXISTS (
    SELECT 1 FROM public.incentive_rule_tiers t WHERE t.incentive_rule_id = p_rule_id
  ) OR EXISTS (
    SELECT 1 FROM public.incentive_rule_tiers t
    WHERE t.incentive_rule_id = p_rule_id
      AND (t.reward_mode IS DISTINCT FROM 'per_delivery'
           OR COALESCE(t.reward_per_delivery_kwd, 0) <= 0)
  ) THEN
    RETURN NULL;
  END IF;

  v_target := public._incentive_rule_dpd_target(p_rule_id, p_on_date);
  IF v_target IS NOT NULL THEN
    -- The target is the gate even when it sits at/above the first threshold;
    -- the rule's own base stays the floor so a low target cannot undercut it.
    RETURN GREATEST(v_target, COALESCE(v_rule.base_minimum_deliveries, 0));
  END IF;

  SELECT min(t.threshold_deliveries) INTO v_first
  FROM public.incentive_rule_tiers t
  WHERE t.incentive_rule_id = p_rule_id;

  SELECT min(t.threshold_deliveries) INTO v_second
  FROM public.incentive_rule_tiers t
  WHERE t.incentive_rule_id = p_rule_id
    AND t.threshold_deliveries > v_first;

  IF COALESCE(v_rule.base_minimum_deliveries, 0) > 0
     AND v_rule.base_minimum_deliveries < v_first THEN
    RETURN v_rule.base_minimum_deliveries;
  END IF;

  IF v_second IS NOT NULL AND v_first - (v_second - v_first) >= 0 THEN
    RETURN v_first - (v_second - v_first);
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Incentive amount: gate every payout on the target
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_incentive_amount(
  p_rule_id uuid,
  p_eligible_count integer,
  p_on_date date
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
  v_cumulative boolean;
  v_band_start int;
  v_gate int;
  v_prev int;
BEGIN
  IF p_eligible_count IS NULL OR p_eligible_count <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Option A gate: a rule with a daily DPD target pays nothing below it,
  -- whatever its reward_mode / payout_mode / overrides_others says.
  v_gate := public._incentive_rule_dpd_target(p_rule_id, p_on_date);
  IF v_gate IS NOT NULL AND p_eligible_count < v_gate THEN
    RETURN 0;
  END IF;

  v_band_start := public._incentive_band_start(p_rule_id, p_on_date);
  IF v_band_start IS NOT NULL THEN
    v_prev := v_band_start;
    FOR v_tier IN
      SELECT t.threshold_deliveries, t.reward_per_delivery_kwd
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = p_rule_id
      ORDER BY t.threshold_deliveries ASC
    LOOP
      IF v_tier.threshold_deliveries > v_prev THEN
        v_band := LEAST(p_eligible_count, v_tier.threshold_deliveries) - v_prev;
        IF v_band > 0 THEN
          v_amount := v_amount + COALESCE(v_tier.reward_per_delivery_kwd, 0) * v_band;
        END IF;
        v_prev := v_tier.threshold_deliveries;
      END IF;
    END LOOP;
    RETURN v_amount;
  END IF;

  v_base := COALESCE(v_rule.base_minimum_deliveries, 0);
  v_cumulative := v_rule.payout_mode = 'cumulative';

  IF p_eligible_count <= v_base THEN
    RETURN 0;
  END IF;

  IF v_rule.target_mode = 'single' THEN
    IF NOT v_cumulative
       AND (v_rule.target_deliveries IS NULL OR p_eligible_count < v_rule.target_deliveries) THEN
      RETURN 0;
    END IF;

    IF v_rule.reward_mode = 'fixed' THEN
      RETURN COALESCE(v_rule.reward_kwd, 0);
    END IF;

    v_band := p_eligible_count - v_base;
    IF v_rule.target_deliveries IS NOT NULL THEN
      v_band := LEAST(v_band, v_rule.target_deliveries - v_base);
    END IF;
    RETURN COALESCE(v_rule.reward_per_delivery_kwd, 0) * GREATEST(v_band, 0);
  END IF;

  FOR v_tier IN
    SELECT *
    FROM public.incentive_rule_tiers t
    WHERE t.incentive_rule_id = p_rule_id
      AND (v_cumulative OR p_eligible_count >= t.threshold_deliveries)
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

-- Two-argument form keeps every existing caller working; it prices today.
CREATE OR REPLACE FUNCTION public.compute_incentive_amount(
  p_rule_id uuid,
  p_eligible_count integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.compute_incentive_amount(
    p_rule_id,
    p_eligible_count,
    (now() AT TIME ZONE 'Asia/Kuwait')::date
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._incentive_rule_dpd_target(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._incentive_band_start(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_incentive_amount(uuid, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_incentive_amount(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._incentive_rule_dpd_target(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._incentive_band_start(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_incentive_amount(uuid, integer, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_incentive_amount(uuid, integer) TO authenticated, service_role;
