-- REVERT of `20261102001300` / `20261102001400`.
--
-- Those two migrations rewrote the date predicate in
-- `admin_count_eligible_deliveries_on_dates` from the cast form
--
--   (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
--
-- to a half-open range plus the cast form, on the premise recorded in
-- `20261102000300_dpd_counters_sargable_days.sql` -- that a function of the column cannot be
-- matched by a btree entry, so the plan reads every delivery the rider has ever recorded.
--
-- **Measured on production, that premise is false for this function, and the rewrite is a
-- regression.** The predicate equivalence was never in question (both forms return exactly the
-- same counts -- 13 = 13 across all 888 drivers, and 0 of 888 rows differ in `actual_deliveries`);
-- what was wrong was the assumption about the access path. Timed over the 888 real
-- (driver_id, rule_id, worked_dates) triples the page actually passes:
--
--   original cast form       11,581 shared buffers     108.7 ms
--   range + cast rewrite    136,956 shared buffers     245.9 ms     (11.8x buffers, 2.3x slower)
--
-- The reason is the index the planner was already using. `deliveries_driver_shift_date_idx` is
-- `(driver_id, shift_date)`, and `shift_date` is the delivery's operational day -- so a rider's
-- rows are clustered by date inside the index, and the cast predicate is cheap to evaluate over
-- the handful of heap pages that rider's recent rows occupy. Adding an explicit `delivered_at`
-- range did not unlock `deliveries_driver_delivered_at_idx`; inside a PL/pgSQL function the
-- statement is planned once and reused, and with `p_driver_id` / the range bounds unknown the
-- added predicate stops being usable as a cheap index condition and turns into a wider scan.
-- Measured directly, the same rewritten query outside PL/pgSQL is *faster* (0.551 ms / 48
-- buffers) -- which is exactly why the rewrite looked right and had to be measured inside the
-- function rather than as a standalone query.
--
-- Note the buffer accounting is not additive with the parent call: `admin_list_driver_performance`
-- measured 307,983 shared buffers before these migrations and 805,188 after, of which the counter
-- accounts for +125,375. The remainder is the outer query's own plan and is being diagnosed
-- separately rather than attributed here.
--
-- This restores the original body byte-for-byte. Nothing else moves: same `p_dates` empty/NULL
-- guard, same `incentive_rules` lookup and early return, same `delivery_matches_rules`, same scope
-- `EXISTS`, same `scope_type` branching, same `COALESCE`. No index, filter, ordering, RLS,
-- permission or business-rule change -- and no index is dropped.

CREATE OR REPLACE FUNCTION public.admin_count_eligible_deliveries_on_dates(
  p_driver_id uuid,
  p_incentive_rule_id uuid,
  p_dates date[]
)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_count integer;
BEGIN
  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN 0;
  END IF;

  IF p_incentive_rule_id IS NULL THEN
    SELECT count(*)::integer INTO v_count
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
      AND public.delivery_matches_rules(
        d.id,
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
      );
    RETURN COALESCE(v_count, 0);
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_incentive_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
    AND public.delivery_matches_rules(
      d.id,
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
    )
    AND EXISTS (
      SELECT 1
      FROM public.incentive_rule_scopes s
      WHERE s.incentive_rule_id = p_incentive_rule_id
        AND (
          (v_rule.scope_type = 'zone' AND s.zone_id = d.zone_id)
          OR (v_rule.scope_type = 'partner' AND s.partner_id = d.partner_id)
          OR (
            v_rule.scope_type = 'restaurant'
            AND s.restaurant_id = public.delivery_scope_restaurant_id(
              d.restaurant_id,
              d.driver_id,
              d.pickup_lat::double precision,
              d.pickup_lng::double precision
            )
          )
        )
    );

  RETURN COALESCE(v_count, 0);
END;
$function$;
