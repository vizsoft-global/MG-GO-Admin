-- P2: the DPD shift-notice cron was reading ~1.7 million buffers every five minutes.
--
-- `admin_dpd_notice_candidates` (the /api/cron/dpd-shift-notices worker) walks every rider who
-- has a shift or an attendance row today or yesterday and, for each one, asks
-- `_driver_daily_dpd_state(driver_id, day)` how the day is going. Measured on production at
-- **10,103 ms and 1,721,576 shared buffers (~13 GB of buffer traffic) per call**, with a
-- recorded mean of 6,912 ms across 420 calls -- and it runs on a five-minute schedule.
--
-- The cause is not the loop, it is the predicate. Every per-rider delivery counter tested
-- `(d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_on_date`. A function of the column
-- cannot be matched by a btree entry, so the plan degraded to
-- `Bitmap Index Scan on deliveries_driver_shift_date_idx, Index Cond: (driver_id = ...)`,
-- which returns *every delivery that rider has ever recorded* -- measured at 3,031 rows for one
-- real rider -- and then discarded 2,964 of them with `Rows Removed by Filter`. In a 650-iteration
-- loop over a 184,300-row table that is the whole 1.7 M buffers.
--
-- The rewrite is the half-open timestamptz range `[day 00:00, day+1 00:00)` in Asia/Kuwait.
-- Asia/Kuwait is a fixed UTC+3 offset with no DST, so the range and the `AT TIME ZONE`
-- expression select exactly the same rows -- proven on production before writing this, per
-- delivery status, not in aggregate:
--
--   pending   183,354 rows: old predicate TRUE 7,644 / new predicate TRUE 7,644
--   cancelled     453 rows: old 28 / new 28
--   verified      477 rows: old 0  / new 0
--   rejected 13 / under_review 4 / in_transit 4: old 0 / new 0
--
-- (A raw `IS DISTINCT FROM` diff over the same rows reports ~430 "mismatches" per day, but that
-- is an artefact of SQL three-valued logic, not a semantic difference: where `delivered_at IS
-- NULL` and `pickup_at` falls outside the day, the old form evaluates FALSE while the new `OR`
-- form evaluates NULL. Both exclude the row from a WHERE clause, which is the only way these
-- predicates are ever used.)
--
-- The `COALESCE(delivered_at, pickup_at)` progress predicate becomes an explicit `OR` because
-- `COALESCE(...) >= x` is itself not sargable; the `delivered_at IS NULL` branch is served by
-- the same index (NULLs are indexed), which the plan confirms as a `BitmapOr` over two range
-- scans of `deliveries_driver_delivered_at_idx`.
--
-- Measured on production for one real driver, one day:
--
--   before  Bitmap Heap Scan, Index Cond (driver_id) only, 3,031 rows read, 2,964 removed
--           12.012 ms / 2,016 buffers
--   after   BitmapOr over two range scans, Index Cond (driver_id, delivered_at range)
--            0.613 ms / 64 buffers          (19.6x faster, 31.5x fewer buffers)
--
-- The two `count_*_deliveries` helpers called from the same loop carry the identical pattern
-- over a `BETWEEN v_period_start AND v_period_end` window and are rewritten the same way
-- (`>= start AND < end + 1`); they are also reached by `driver_get_extra_earnings` and
-- `driver_get_home_dashboard`, which is why the fix is worth making once in the helper rather
-- than once per caller.
--
-- Nothing else moves: every returned column, every status list, every period calculation,
-- `delivery_matches_rules` / `delivery_progress_matches_rules`, the scope `EXISTS` block and
-- both `jsonb_build_object` payloads are byte-identical. This is a predicate rewrite only --
-- no filter, ordering, pagination, RLS, permission or business rule changes.
--
-- No new index is added here: `deliveries_driver_delivered_at_idx` already existed and was
-- simply unusable behind the cast, which is why the fix is a rewrite rather than an index.

CREATE OR REPLACE FUNCTION public._driver_daily_dpd_state(p_driver_id uuid, p_on_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

  FOR v_rule IN
    SELECT ir.id
    FROM public.incentive_rules ir
    WHERE ir.status = 'active'
      AND p_on_date BETWEEN ir.start_date AND ir.end_date
      AND public.incentive_rule_matches_driver(ir.id, p_driver_id)
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

CREATE OR REPLACE FUNCTION public.count_eligible_deliveries(p_driver_id uuid, p_earn_date date, p_incentive_rule_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_period_start date;
  v_period_end date;
  v_count int;
BEGIN
  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_incentive_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_period_end := p_earn_date;

  CASE v_rule.period
    WHEN 'daily' THEN
      v_period_start := p_earn_date;
    WHEN 'weekly' THEN
      v_period_start := public.kuwait_week_start(p_earn_date);
    WHEN 'monthly' THEN
      v_period_start := public.kuwait_month_start(p_earn_date);
  END CASE;

  SELECT count(*)::int INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    -- Inclusive date window expressed as a half-open timestamptz range so the
    -- (driver_id, delivered_at) index can range-scan it instead of reading the rider's
    -- entire delivery history and filtering the cast.
    AND d.delivered_at >= (v_period_start::timestamp AT TIME ZONE 'Asia/Kuwait')
    AND d.delivered_at < (((v_period_end + 1)::timestamp) AT TIME ZONE 'Asia/Kuwait')
    AND public.delivery_matches_rules(d.id, p_earn_date)
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

CREATE OR REPLACE FUNCTION public.count_progress_deliveries(p_driver_id uuid, p_earn_date date, p_incentive_rule_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule public.incentive_rules%ROWTYPE;
  v_period_start date;
  v_period_end date;
  v_count int;
  v_period_start_ts timestamptz;
  v_period_end_ts timestamptz;
BEGIN
  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_incentive_rule_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_period_end := p_earn_date;

  CASE v_rule.period
    WHEN 'daily' THEN
      v_period_start := p_earn_date;
    WHEN 'weekly' THEN
      v_period_start := public.kuwait_week_start(p_earn_date);
    WHEN 'monthly' THEN
      v_period_start := public.kuwait_month_start(p_earn_date);
  END CASE;

  v_period_start_ts := (v_period_start::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_period_end_ts := (((v_period_end + 1)::timestamp) AT TIME ZONE 'Asia/Kuwait');

  SELECT count(*)::int INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
    AND (
      (d.delivered_at >= v_period_start_ts AND d.delivered_at < v_period_end_ts)
      OR (
        d.delivered_at IS NULL
        AND d.pickup_at >= v_period_start_ts
        AND d.pickup_at < v_period_end_ts
      )
    )
    AND public.delivery_progress_matches_rules(d.id, p_earn_date)
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
