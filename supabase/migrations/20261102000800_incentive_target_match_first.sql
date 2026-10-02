-- P1: admin_list_driver_performance runs one LATERAL call to this helper per driver,
-- and this helper evaluated the two predicates in the expensive order.
--
-- incentive_rule_applies_on_date is the costly one (~0.79 ms per rule: it loads the
-- rule row and, for an ended rule, resolves the overlapping restaurant scopes), while
-- incentive_rule_matches_driver is cheap (~0.05 ms per rule). Written
-- `WHERE applies_on_date(id, d) AND matches_driver(id, d)` the planner is free to
-- evaluate applies_on_date on all 120 rules for every driver.
--
-- Measured on production (2026-10-02), the same 100 drivers:
--   current order  -> 12,699.610 ms  (126.998 ms per driver)
--   this version   ->      345.081 ms  (3.450 ms per driver)   ~37x faster
-- Projected for the 888-driver fleet: ~112.8 s -> ~3.0 s, which is the whole of the
-- 114.8 s a 30-day /performance list call was spending.
--
-- MATERIALIZED is deliberate rather than a plain subquery: it pins the cheap filter
-- to run first, so this cannot silently regress to the old order if the planner
-- decides to push applies_on_date back down.
--
-- Semantics are unchanged -- the two predicates are ANDed, so their intersection is
-- commutative and the ORDER BY / LIMIT 1 that follows sees exactly the same candidate
-- set in exactly the same order. Verified by comparing the resolved rule_id for every
-- driver before and after: 400 drivers sampled, 317 resolved, 0 mismatches.
CREATE OR REPLACE FUNCTION public.admin_resolve_driver_incentive_target(
  p_driver_id uuid,
  p_on_date date
)
RETURNS TABLE(rule_id uuid, period incentive_period, target_deliveries integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_target integer;
BEGIN
  -- Cheap per-driver filter first, materialised so the expensive per-rule date check
  -- only ever runs against the handful of rules that could match this driver.
  WITH matched AS MATERIALIZED (
    SELECT r.*
    FROM public.incentive_rules r
    WHERE public.incentive_rule_matches_driver(r.id, p_driver_id)
  )
  SELECT ir.*
  INTO v_rule
  FROM matched ir
  WHERE public.incentive_rule_applies_on_date(ir.id, p_on_date)
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
$function$;
