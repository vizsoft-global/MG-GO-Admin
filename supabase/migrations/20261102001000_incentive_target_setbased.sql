-- P1 (list-page heavy query): /performance Riders' Analysis was the slowest
-- remaining admin page at 4,628 ms / 1,401,271 buffers, and 3,388 ms of that
-- was admin_resolve_driver_incentive_target called once per driver through a
-- LATERAL (888 drivers x ~115 rule probes = ~102,000 SECURITY DEFINER calls,
-- each with its own plan and executor startup).
--
-- This adds a set-based equivalent that answers the whole fleet in one plan:
-- incentive_rule_applies_on_date runs once per rule (120 calls, not 102,000)
-- and the driver/rule scope match becomes joins instead of per-rule EXISTS.
--
-- Semantics are deliberately identical to admin_resolve_driver_incentive_target
-- (which stays in place, untouched, for its other callers and as the reference
-- the new function is asserted against):
--   * same scope predicate as incentive_rule_matches_driver
--     (zone / partner / the driver's assigned restaurants),
--   * the same applies-on-date gate,
--   * the same winner ORDER BY, including the id DESC tiebreak,
--   * the same target_deliveries formula
--     (tiered -> max(threshold_deliveries), else target_deliveries).
-- No business rule is changed; only how many times it is evaluated.

CREATE OR REPLACE FUNCTION public.admin_resolve_incentive_targets(
  p_on_date date,
  p_driver_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  driver_id uuid,
  rule_id uuid,
  period public.incentive_period,
  target_deliveries integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH drv AS MATERIALIZED (
    SELECT d.id AS driver_id, d.zone_id, d.partner_id
    FROM public.drivers d
    WHERE p_driver_ids IS NULL OR d.id = ANY (p_driver_ids)
  ),
  -- Driver-independent: one evaluation per rule, materialised so it cannot be
  -- re-run once per driver by the joins below.
  rul AS MATERIALIZED (
    SELECT
      r.id AS rule_id,
      r.status,
      r.priority,
      r.created_at,
      r.period,
      r.target_mode,
      r.target_deliveries,
      r.base_minimum_deliveries,
      r.scope_type
    FROM public.incentive_rules r
    WHERE p_on_date IS NOT NULL
      AND public.incentive_rule_applies_on_date(r.id, p_on_date)
  ),
  dr_rest AS MATERIALIZED (
    SELECT dr.driver_id, dr.restaurant_id
    FROM public.driver_restaurants dr
    JOIN drv ON drv.driver_id = dr.driver_id
  ),
  scoped_zone_partner AS (
    SELECT DISTINCT drv.driver_id, s.incentive_rule_id AS rule_id
    FROM public.incentive_rule_scopes s
    JOIN rul ON rul.rule_id = s.incentive_rule_id
    JOIN drv ON
         (rul.scope_type = 'zone'    AND s.zone_id = drv.zone_id)
      OR (rul.scope_type = 'partner' AND s.partner_id = drv.partner_id)
  ),
  scoped_restaurant AS (
    SELECT DISTINCT drs.driver_id, s.incentive_rule_id AS rule_id
    FROM public.incentive_rule_scopes s
    JOIN rul ON rul.rule_id = s.incentive_rule_id
            AND rul.scope_type = 'restaurant'
    JOIN dr_rest drs ON drs.restaurant_id = s.restaurant_id
  ),
  scoped AS MATERIALIZED (
    SELECT * FROM scoped_zone_partner
    UNION
    SELECT * FROM scoped_restaurant
  ),
  winner AS (
    SELECT DISTINCT ON (sc.driver_id)
      sc.driver_id,
      sc.rule_id,
      ru.period,
      ru.target_mode,
      ru.target_deliveries,
      ru.base_minimum_deliveries
    FROM scoped sc
    JOIN rul ru ON ru.rule_id = sc.rule_id
    ORDER BY
      sc.driver_id,
      CASE WHEN ru.status = 'active' THEN 0 ELSE 1 END,
      ru.priority DESC,
      CASE WHEN ru.status = 'active' THEN ru.created_at END ASC NULLS LAST,
      ru.created_at DESC,
      ru.rule_id DESC
  ),
  tier_max AS MATERIALIZED (
    SELECT t.incentive_rule_id, max(t.threshold_deliveries) AS max_threshold
    FROM public.incentive_rule_tiers t
    GROUP BY t.incentive_rule_id
  )
  SELECT
    w.driver_id,
    w.rule_id,
    w.period,
    CASE
      WHEN w.target_mode = 'tiered'
        THEN COALESCE(tm.max_threshold, w.base_minimum_deliveries, 0)
      ELSE COALESCE(w.target_deliveries, 0)
    END
  FROM winner w
  LEFT JOIN tier_max tm ON tm.incentive_rule_id = w.rule_id;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) TO authenticated;
