-- P1: `/performance` was still reading all 307,983 buffers in one call, and it is one missed
-- predicate, not a missing index.
--
-- `admin_list_driver_performance` calls `admin_count_eligible_deliveries_on_dates` once per rider
-- in the roster -- 888 calls for the open month -- and measures **1,243.2 ms / 307,983 shared
-- buffers**. Migration `20261102000300_dpd_counters_sargable_days.sql` fixed exactly this class of
-- predicate in `_driver_daily_dpd_state` and the two `count_*_deliveries` helpers, but this
-- sibling was missed, so it still tests
--
--   (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = ANY (p_dates)
--
-- A function of the column cannot be matched by a btree entry, so `deliveries_driver_delivered_at_idx`
-- -- which exists and is on `(driver_id, delivered_at)` -- is unusable and the plan degrades to
-- reading *every delivery that rider has ever recorded* and discarding them with
-- `Rows Removed by Filter`. Multiplied by 888 riders that is the whole 307,983 buffers.
--
-- The rewrite adds a half-open timestamptz window `[min(day) 00:00, (max(day)+1) 00:00)` in
-- Asia/Kuwait. The existing exact `= ANY (p_dates)` predicate is **kept** and still does the
-- precise filtering; the range only exists so the index can range-scan the candidate set instead
-- of the rider's history. `p_dates` is an arbitrary (not necessarily contiguous) array of the
-- rider's worked days, which is why the bound is min/max rather than a period.
--
-- Asia/Kuwait is a fixed UTC+3 offset with no DST, and the exact predicate must imply the range,
-- so the two select the same rows. Proven on production before writing this, over every real row
-- rather than in aggregate:
--
--   distinct Asia/Kuwait offsets across all deliveries   1        (fixed offset, no DST)
--   verified rows where `exact` does NOT imply the range  0 of 477
--   (driver, Kuwait day) pairs compared                  101      mismatches 0
--   same, totals                                         477 old = 477 new
--   30-day span (the array the list actually passes)      65 drivers, mismatches 0, 110 old = 110 new
--
-- Nothing else moves: the return value, the `p_dates` empty/NULL guard, the `incentive_rules`
-- lookup and early return, `delivery_matches_rules`, the scope `EXISTS` block, `scope_type`
-- branching and `COALESCE` are byte-identical. This is a predicate rewrite only -- no filter,
-- ordering, pagination, RLS, permission or business-rule change.
--
-- No new index: `deliveries_driver_delivered_at_idx` already existed and was simply unusable
-- behind the cast, which is why this is a rewrite rather than an index.
--
-- NOTE: this file's first form used `min(p_dates)`/`max(p_dates)` directly, which Postgres
-- resolves to the array aggregate rather than the element-wise one, and the cast to `timestamp`
-- therefore raised `42846` on the first rider with worked days. The bodies here and in
-- `20261102001400_eligible_deliveries_array_bounds_fix.sql` now both take the bounds from
-- `unnest(p_dates)`; 01400 is what corrected production, and this file is corrected so a replay
-- from scratch is right at every step.

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
  -- Half-open window covering every requested Kuwait day. Bounds come from the array's elements
  -- via `unnest`, because `min(p_dates)` resolves to the *array* aggregate and returns a `date[]`.
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
