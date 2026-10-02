-- IMMEDIATE FIX for `20261102001300_eligible_deliveries_sargable_dates.sql`.
--
-- That migration shipped an array-bounds bug: it computed the window with
--
--   min(p_dates)::timestamp
--   (max(p_dates) + 1)::timestamp
--
-- but `p_dates` is a `date[]`, and Postgres resolves `min`/`max` over an array type to the
-- **array** aggregate (`min(anyarray) -> anyarray`, which for a single array value just returns
-- that array). So the expression evaluated to a `date[]` and the cast raised
--
--   ERROR: 42846: cannot cast type date[] to timestamp without time zone
--
-- on the first call with a non-empty array. The `p_dates IS NULL OR cardinality = 0` guard
-- returns early for riders with no worked days, so only riders who actually worked raised --
-- which is to say `/performance` failed whenever the month had any attendance at all.
--
-- The bounds must come from the array's *elements*, so they are taken with `unnest`.
--
--   SELECT min(x), max(x) INTO v_day_lo, v_day_hi FROM unnest(p_dates) AS x;
--
-- Everything else is byte-identical to 01300: same kept `= ANY (p_dates)` predicate, same
-- `delivery_matches_rules`, same scope `EXISTS`, same `scope_type` branching, same `COALESCE`,
-- same empty-array guard and missing-rule early return. `CREATE OR REPLACE` preserves the
-- existing ACL. No index, filter, ordering, RLS, permission or business-rule change.
--
-- The equivalence of the range predicate to the original cast predicate was proven on
-- production before 01300 was written: 1 distinct Asia/Kuwait offset (fixed UTC+3, no DST),
-- 0 containment violations across 477 verified rows, 0 mismatches over 101 (driver, Kuwait day)
-- pairs (477 old = 477 new) and 0 mismatches over the 30-day span (110 old = 110 new).

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
  -- Window bounds come from the array's elements, not from `min(array)` -- see the header note.
  v_day_lo date;
  v_day_hi date;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN 0;
  END IF;

  SELECT min(x), max(x) INTO v_day_lo, v_day_hi FROM unnest(p_dates) AS x;

  v_from := (v_day_lo::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_to   := ((v_day_hi + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  IF p_incentive_rule_id IS NULL THEN
    SELECT count(*)::integer INTO v_count
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      -- Range first so (driver_id, delivered_at) can be range-scanned; the exact cast predicate
      -- below is what actually selects the requested days.
      AND d.delivered_at >= v_from
      AND d.delivered_at <  v_to
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
    AND d.delivered_at >= v_from
    AND d.delivered_at <  v_to
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
