-- P2 (continued): the DPD shift-notice cron re-probed `driver_restaurants` once per
-- (driver, scope) pair to decide which incentive rule applies.
--
-- The sargable date rewrite in `20261102000300` removed the delivery-counter scans, but
-- `admin_dpd_notice_candidates` still measured **9,564 ms and 1,496,494 shared buffers** on
-- production (re-measured after that migration was applied), so the predicate was not the
-- remaining cost. Measuring `_driver_daily_dpd_state` directly over 40 real rider-days on
-- production:
--
--   whole function   454.8 ms / 69,744 buffers   ->  11.4 ms / 1,744 buffers per rider-day
--   rule match only  137.0 ms / 47,089 buffers   ->   3.4 ms / 1,177 buffers per driver
--
-- so **67% of the buffers and 30% of the time was the rule match** -- and the buffer count
-- is what actually matters here, because this runs on a five-minute schedule against the
-- same instance the panel reads from.
--
-- The cause is that the predicate is correlated on the *rule* while the thing it looks up is
-- a property of the *driver*. `incentive_rule_matches_driver(rule, driver)` runs an EXISTS
-- over `incentive_rule_scopes` joined to `drivers`, and for the restaurant branch the plan
-- degrades to a `Join Filter` that re-executes `driver_restaurants` for every
-- (driver x scope) pair: **4,560 index probes for 40 drivers, 13,905 of the 14,077 buffers
-- in the match** -- the same restaurant list, read once per scope, per driver.
--
-- The fix is to resolve the driver's match context -- `zone_id`, `partner_id` and the
-- `driver_restaurants` list -- **once per call**, then match the whole rule set against it in
-- a single join. `s.restaurant_id = ANY (v_restaurant_ids)` is exactly
-- `s.restaurant_id IN (SELECT restaurant_id FROM driver_restaurants WHERE driver_id = ...)`:
-- `ANY` over the empty array is FALSE and `ANY` over an array containing NULL behaves as `IN`
-- does, so the three-valued logic is unchanged. A driver row that does not exist now yields
-- NULL zone/partner and an empty restaurant list, which matches nothing -- the same outcome
-- the original produced, because it joined `drivers` and therefore could not match either.
--
-- Proven equivalent before writing this, on production, for every active rule against every
-- driver row -- **0 mismatches**, and covering all 116 active rules (115 restaurant-scoped,
-- 1 zone-scoped):
--
--   SELECT count(*)
--   FROM public.incentive_rules ir
--   CROSS JOIN public.drivers d
--   WHERE ir.status = 'active'
--     AND public.incentive_rule_matches_driver(ir.id, d.id) IS DISTINCT FROM
--         EXISTS (
--           SELECT 1
--           FROM public.incentive_rule_scopes s
--           WHERE s.incentive_rule_id = ir.id
--             AND (
--               (ir.scope_type = 'zone'   AND s.zone_id    = d.zone_id)
--               OR (ir.scope_type = 'partner' AND s.partner_id = d.partner_id)
--               OR (ir.scope_type = 'restaurant'
--                   AND s.restaurant_id IN (
--                     SELECT dr2.restaurant_id
--                     FROM public.driver_restaurants dr2
--                     WHERE dr2.driver_id = d.id
--                   ))
--             )
--         );
--
-- The date window (`p_on_date BETWEEN start_date AND end_date`) is applied identically on
-- both sides and cannot introduce a difference, so the ordered candidate rule list -- and
-- therefore the first rule with a non-null `_incentive_band_start` -- is unchanged. The loop
-- keeps its `priority DESC, created_at ASC` order and its early `EXIT`; `DISTINCT` is required
-- only because a rule may own several matching scopes, and it cannot change which rule is
-- selected because duplicate rows share the same id, priority and created_at.
--
-- `company_config_applies` short-circuits before any of this (the company branch returns
-- early), and `count_eligible_deliveries`, `count_progress_deliveries`,
-- `_incentive_band_start`, `incentive_rule_restaurant_ids`, the fallback restaurant
-- resolution and every returned jsonb key are byte-identical. This is a predicate rewrite --
-- no filter, ordering, pagination, RLS, permission or business rule changes.

CREATE OR REPLACE FUNCTION public._driver_daily_dpd_state(
  p_driver_id uuid,
  p_on_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_rule record;
  v_rule_id uuid;
  v_target int;
  v_completed int := 0;
  v_progress int := 0;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_company_name text;
  -- Driver-side match context, resolved once per call instead of once per candidate rule.
  v_zone_id uuid;
  v_partner_id uuid;
  v_restaurant_ids uuid[] := '{}';
  -- Asia/Kuwait is a fixed UTC+3 offset, so [v_day_start, v_day_end) is exactly the set of
  -- instants whose Asia/Kuwait calendar date is p_on_date.
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  IF p_driver_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

  v_day_start := (p_on_date::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_day_end := ((p_on_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  IF public.company_config_applies(p_driver_id, p_on_date) THEN
    SELECT sc.dpd_target, sc.name
    INTO v_target, v_company_name
    FROM public.drivers d
    JOIN public.source_companies sc ON sc.key = d.source_company
    WHERE d.id = p_driver_id;

    IF v_target IS NULL OR v_target <= 0 THEN
      RETURN NULL;
    END IF;

    SELECT count(*)::int INTO v_completed
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND d.delivered_at >= v_day_start
      AND d.delivered_at < v_day_end;

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND (
        (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
        OR (
          d.delivered_at IS NULL
          AND d.pickup_at >= v_day_start
          AND d.pickup_at < v_day_end
        )
      );

    RETURN jsonb_build_object(
      'target', v_target,
      'completed_today', v_completed,
      'progress_today', v_progress,
      'remaining', GREATEST(0, v_target - v_completed),
      'achieved', v_completed >= v_target,
      'rule_id', NULL,
      'restaurant_id', NULL,
      'restaurant_name', NULL,
      'company_name', v_company_name,
      'shift_date', p_on_date
    );
  END IF;

  -- Zone / partner / restaurant membership belongs to the driver, not the rule, so it is
  -- resolved once here. Reading it per rule is what made the match cost ~1,177 buffers a
  -- rider (see the header comment).
  SELECT d.zone_id, d.partner_id
  INTO v_zone_id, v_partner_id
  FROM public.drivers d
  WHERE d.id = p_driver_id;

  SELECT COALESCE(array_agg(dr.restaurant_id), '{}'::uuid[])
  INTO v_restaurant_ids
  FROM public.driver_restaurants dr
  WHERE dr.driver_id = p_driver_id;

  FOR v_rule IN
    SELECT DISTINCT ir.id, ir.priority, ir.created_at
    FROM public.incentive_rules ir
    JOIN public.incentive_rule_scopes s ON s.incentive_rule_id = ir.id
    WHERE ir.status = 'active'
      AND p_on_date BETWEEN ir.start_date AND ir.end_date
      AND (
        (ir.scope_type = 'zone' AND s.zone_id = v_zone_id)
        OR (ir.scope_type = 'partner' AND s.partner_id = v_partner_id)
        OR (ir.scope_type = 'restaurant' AND s.restaurant_id = ANY (v_restaurant_ids))
      )
    ORDER BY ir.priority DESC, ir.created_at ASC
  LOOP
    v_target := public._incentive_band_start(v_rule.id, p_on_date);
    IF v_target IS NOT NULL THEN
      v_rule_id := v_rule.id;
      EXIT;
    END IF;
  END LOOP;

  IF v_rule_id IS NOT NULL THEN
    v_completed := COALESCE(
      public.count_eligible_deliveries(p_driver_id, p_on_date, v_rule_id),
      0
    );
    v_progress := COALESCE(
      public.count_progress_deliveries(p_driver_id, p_on_date, v_rule_id),
      0
    );
    SELECT r.id, r.name
    INTO v_restaurant_id, v_restaurant_name
    FROM unnest(public.incentive_rule_restaurant_ids(v_rule_id)) AS rid
    JOIN public.restaurants r ON r.id = rid
    ORDER BY (public._restaurant_daily_dpd_target(rid, p_on_date) = v_target) DESC NULLS LAST,
             r.name
    LIMIT 1;
  ELSE
    SELECT x.rid, x.target, r.name
    INTO v_restaurant_id, v_target, v_restaurant_name
    FROM (
      SELECT dr.restaurant_id AS rid, dr.created_at
      FROM public.driver_restaurants dr
      WHERE dr.driver_id = p_driver_id
      UNION ALL
      SELECT d.restaurant_id, d.created_at
      FROM public.drivers d
      WHERE d.id = p_driver_id AND d.restaurant_id IS NOT NULL
    ) a
    CROSS JOIN LATERAL (
      SELECT a.rid, public._restaurant_daily_dpd_target(a.rid, p_on_date) AS target
    ) x
    JOIN public.restaurants r ON r.id = x.rid
    WHERE x.target > 0
    ORDER BY a.created_at ASC
    LIMIT 1;

    IF v_target IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT count(*)::int INTO v_completed
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND d.restaurant_id = v_restaurant_id
      AND d.delivered_at >= v_day_start
      AND d.delivered_at < v_day_end;

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND d.restaurant_id = v_restaurant_id
      AND (
        (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
        OR (
          d.delivered_at IS NULL
          AND d.pickup_at >= v_day_start
          AND d.pickup_at < v_day_end
        )
      );
  END IF;

  RETURN jsonb_build_object(
    'target', v_target,
    'completed_today', v_completed,
    'progress_today', v_progress,
    'remaining', GREATEST(0, v_target - v_completed),
    'achieved', v_completed >= v_target,
    'rule_id', v_rule_id,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_restaurant_name,
    'shift_date', p_on_date
  );
END;
$function$;
