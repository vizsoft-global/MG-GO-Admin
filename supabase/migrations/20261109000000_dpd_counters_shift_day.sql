-- QA #11 — a shift that crosses midnight reported the post-midnight orders on the
-- wrong day (or not at all).
--
-- `deliveries.shift_date` has existed since 20261030600000 and is stamped by
-- `deliveries_stamp_shift_date` from `delivery_shift_date(driver_id, instant)`,
-- which maps an instant inside a 14:00–02:00 window to the shift's own day. The
-- DPD counters, however, still attributed a delivery by the Kuwait *calendar*
-- day of `delivered_at`:
--
--     AND d.delivered_at >= (p_on_date::timestamp AT TIME ZONE 'Asia/Kuwait')
--     AND d.delivered_at <  ((p_on_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
--
-- so a rider on a 14:00–02:00 shift who finished four orders at 01:00 saw them
-- counted on tomorrow's card: the Daily DPD target looked short on the shift day
-- and the Home card / Extra Earnings progress disagreed with what the rider did.
--
-- The fix is to attribute by `shift_date`, which is exactly the day the shift
-- belongs to, and fall back to the calendar day only for a row whose
-- `shift_date` is somehow still NULL (the trigger and the 168k backfill make
-- that a defensive branch, not a live one). Three functions are rewritten:
--
--   * `_driver_daily_dpd_state`  — company branch + fallback restaurant branch
--   * `count_eligible_deliveries` — verified payout / Home eligible count
--   * `count_progress_deliveries` — submitted progress count
--
-- Sargability is preserved: `d.shift_date = p_on_date` and
-- `d.shift_date BETWEEN ...` are served by `deliveries_driver_shift_date_idx`
-- (driver_id, shift_date), which is what the 20261102000300 rewrite was for.
-- The `COALESCE(shift_date, calendar)` form is deliberately *not* used in the
-- predicate because it would defeat the index again; the fallback is an explicit
-- `shift_date IS NULL AND <calendar range>` OR-branch instead.
--
-- Nothing else moves: every returned column, status list, period calculation,
-- `delivery_matches_rules` / `delivery_progress_matches_rules` call, scope
-- EXISTS block, ordering and jsonb payload is byte-identical. This is an
-- attribution change only.

-- ---------------------------------------------------------------------------
-- _driver_daily_dpd_state — latest body is 20261102000500 (rule-match hoist)
-- ---------------------------------------------------------------------------
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
  -- instants whose Asia/Kuwait calendar date is p_on_date. Only used for the legacy
  -- shift_date IS NULL fallback below.
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
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND d.delivered_at >= v_day_start
          AND d.delivered_at < v_day_end
        )
      );

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND (
            (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
            OR (
              d.delivered_at IS NULL
              AND d.pickup_at >= v_day_start
              AND d.pickup_at < v_day_end
            )
          )
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
  -- rider (see the header comment in 20261102000500).
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
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND d.delivered_at >= v_day_start
          AND d.delivered_at < v_day_end
        )
      );

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND d.restaurant_id = v_restaurant_id
      AND (
        d.shift_date = p_on_date
        OR (
          d.shift_date IS NULL
          AND (
            (d.delivered_at >= v_day_start AND d.delivered_at < v_day_end)
            OR (
              d.delivered_at IS NULL
              AND d.pickup_at >= v_day_start
              AND d.pickup_at < v_day_end
            )
          )
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

-- ---------------------------------------------------------------------------
-- count_eligible_deliveries — verified payout / Home eligible count
-- ---------------------------------------------------------------------------
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
  v_period_start_ts timestamptz;
  v_period_end_ts timestamptz;
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

  v_period_start_ts := (v_period_start::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_period_end_ts := (((v_period_end + 1)::timestamp) AT TIME ZONE 'Asia/Kuwait');

  SELECT count(*)::int INTO v_count
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    -- Shift-day attribution: a 14:00-02:00 shift's post-midnight orders belong to
    -- the shift's own day. `shift_date` is indexed (driver_id, shift_date), so this
    -- range-scan stays sargable. NULL shift_date (legacy rows only) falls back to the
    -- Kuwait calendar window.
    AND (
      d.shift_date BETWEEN v_period_start AND v_period_end
      OR (
        d.shift_date IS NULL
        AND d.delivered_at >= v_period_start_ts
        AND d.delivered_at < v_period_end_ts
      )
    )
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

-- ---------------------------------------------------------------------------
-- count_progress_deliveries — submitted progress count
-- ---------------------------------------------------------------------------
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
    -- Same shift-day attribution as count_eligible_deliveries; a still-open pickup
    -- may have no delivered_at, so the NULL-shift_date branch also reads pickup_at.
    AND (
      d.shift_date BETWEEN v_period_start AND v_period_end
      OR (
        d.shift_date IS NULL
        AND (
          (d.delivered_at >= v_period_start_ts AND d.delivered_at < v_period_end_ts)
          OR (
            d.delivered_at IS NULL
            AND d.pickup_at >= v_period_start_ts
            AND d.pickup_at < v_period_end_ts
          )
        )
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
