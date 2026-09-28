-- Rider Daily DPD Target (SOP v1.0, 24 Sep 2026).
--
-- 1. Band payout: for tiered rules whose tiers are all per-delivery, the
--    bonus is paid per order above the daily DPD target, in consecutive
--    bands ending at each tier threshold, at that tier's rate. Target 10,
--    tiers 15/20/25 at 0.250/0.350/0.400 -> 13 = 0.750, 25 = 5.000.
--    Fixed tiers and single-target rules keep the previous math.
-- 2. The band start is the restaurant's delivery_rules.dpd_target (same
--    restaurant -> zone resolution as admin_dpd_efficiency_snapshot).
-- 3. Earn dates before app_settings.incentive_band_math_from keep the
--    previous math, so recalculating a past day never rewrites a payout
--    made under the old rule.
-- 4. driver_get_extra_earnings adds daily_dpd + per-offer band fields.
-- 5. driver_dpd_shift_notices is the once-per-kind-per-shift-day ledger for
--    the warning / congrats / summary messages sent by the admin cron.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS incentive_band_math_from date;

COMMENT ON COLUMN public.app_settings.incentive_band_math_from IS
  'Earn dates on/after this Kuwait date pay tiered per-delivery incentives in SOP bands above the daily DPD target. Earlier dates keep the legacy stacked math.';

UPDATE public.app_settings
SET incentive_band_math_from = (now() AT TIME ZONE 'Asia/Kuwait')::date
WHERE incentive_band_math_from IS NULL;

-- ---------------------------------------------------------------------------
-- Daily DPD target for a restaurant on a date
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._restaurant_daily_dpd_target(
  p_restaurant_id uuid,
  p_on_date date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH restaurant_rules AS (
    SELECT dr.dpd_target, dr.priority, dr.created_at
    FROM public.delivery_rules dr
    JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
    WHERE s.restaurant_id = p_restaurant_id
      AND dr.status = 'active'
      AND dr.scope_type = 'restaurant'
      AND dr.dpd_target > 0
      AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
      AND p_on_date BETWEEN dr.start_date AND dr.end_date
    UNION ALL
    SELECT dr.dpd_target, dr.priority, dr.created_at
    FROM public.delivery_rules dr
    WHERE dr.restaurant_id = p_restaurant_id
      AND dr.status = 'active'
      AND dr.scope_type = 'restaurant'
      AND dr.dpd_target > 0
      AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
      AND p_on_date BETWEEN dr.start_date AND dr.end_date
  ),
  zone_rules AS (
    SELECT dr.dpd_target, dr.priority, dr.created_at
    FROM public.restaurants r
    JOIN public.delivery_rule_scopes s ON s.zone_id = r.zone_id
    JOIN public.delivery_rules dr ON dr.id = s.delivery_rule_id
    WHERE r.id = p_restaurant_id
      AND r.zone_id IS NOT NULL
      AND dr.status = 'active'
      AND dr.scope_type = 'zone'
      AND dr.dpd_target > 0
      AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
      AND p_on_date BETWEEN dr.start_date AND dr.end_date
    UNION ALL
    SELECT dr.dpd_target, dr.priority, dr.created_at
    FROM public.restaurants r
    JOIN public.delivery_rules dr ON dr.zone_id = r.zone_id
    WHERE r.id = p_restaurant_id
      AND r.zone_id IS NOT NULL
      AND dr.status = 'active'
      AND dr.scope_type = 'zone'
      AND dr.dpd_target > 0
      AND (dr.dpd_period IS NULL OR dr.dpd_period = 'daily')
      AND p_on_date BETWEEN dr.start_date AND dr.end_date
  )
  SELECT COALESCE(
    (SELECT ceil(dpd_target)::int FROM restaurant_rules
     ORDER BY priority DESC, created_at ASC LIMIT 1),
    (SELECT ceil(dpd_target)::int FROM zone_rules
     ORDER BY priority DESC, created_at ASC LIMIT 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- Where the per-order bands of a rule start (the daily target), or NULL when
-- the rule is not a band rule on that date.
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
  v_from date;
  v_first int;
  v_second int;
  v_target int;
BEGIN
  IF p_rule_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT incentive_band_math_from INTO v_from
  FROM public.app_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
  IF v_from IS NULL OR p_on_date < v_from THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND OR v_rule.target_mode IS DISTINCT FROM 'tiered' THEN
    RETURN NULL;
  END IF;

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

  SELECT min(t.threshold_deliveries) INTO v_first
  FROM public.incentive_rule_tiers t
  WHERE t.incentive_rule_id = p_rule_id;

  SELECT min(t.threshold_deliveries) INTO v_second
  FROM public.incentive_rule_tiers t
  WHERE t.incentive_rule_id = p_rule_id
    AND t.threshold_deliveries > v_first;

  -- A target at or above the first threshold would leave no band to pay.
  SELECT x.target INTO v_target
  FROM unnest(public.incentive_rule_restaurant_ids(p_rule_id)) AS rid
  CROSS JOIN LATERAL (
    SELECT public._restaurant_daily_dpd_target(rid, p_on_date) AS target
  ) x
  WHERE x.target > 0 AND x.target < v_first
  ORDER BY x.target DESC
  LIMIT 1;
  IF v_target IS NOT NULL THEN
    RETURN v_target;
  END IF;

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
-- Incentive amount
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
  v_prev int;
BEGIN
  IF p_eligible_count IS NULL OR p_eligible_count <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_rule FROM public.incentive_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
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

-- Earnings writers price the day they are writing, not today.
DO $$
DECLARE
  r record;
  v_def text;
  v_seen int := 0;
  v_old constant text := 'public.compute_incentive_amount(v_rule.id, v_eligible_count)';
  v_rep constant text := 'public.compute_incentive_amount(v_rule.id, v_eligible_count, p_earn_date)';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'recalculate_driver_earnings',
        'get_driver_earnings_detail',
        'preview_driver_earnings'
      )
  LOOP
    v_seen := v_seen + 1;
    v_def := pg_get_functiondef(r.oid);
    IF position(v_rep IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'band math: expected exactly one compute_incentive_amount call in %', r.proname;
    END IF;
    EXECUTE replace(v_def, v_old, v_rep);
  END LOOP;

  IF v_seen <> 3 THEN
    RAISE EXCEPTION 'band math: expected 3 earnings functions, found %', v_seen;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rider daily DPD state (card + notices share it)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._driver_daily_dpd_state(
  p_driver_id uuid,
  p_on_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_rule_id uuid;
  v_target int;
  v_completed int := 0;
  v_restaurant_id uuid;
  v_restaurant_name text;
BEGIN
  IF p_driver_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- Primary offer: same order as driver_get_extra_earnings lists them.
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
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_on_date;
  END IF;

  RETURN jsonb_build_object(
    'target', v_target,
    'completed_today', v_completed,
    'remaining', GREATEST(0, v_target - v_completed),
    'achieved', v_completed >= v_target,
    'rule_id', v_rule_id,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_restaurant_name,
    'shift_date', p_on_date
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- driver_get_extra_earnings: + daily_dpd, display_name, band fields
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_get_extra_earnings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_today date;
  v_rule record;
  v_eligible int;
  v_progress int;
  v_target int;
  v_remaining int;
  v_full_reward numeric(10, 3);
  v_current_reward numeric(10, 3);
  v_scope_label text;
  v_offers jsonb := '[]'::jsonb;
  v_band_start int;
  v_cur_threshold int;
  v_cur_rate numeric;
  v_next_rate numeric;
  v_band_fields jsonb;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_driver_id) THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;

  FOR v_rule IN
    SELECT ir.*
    FROM public.incentive_rules ir
    WHERE ir.status = 'active'
      AND v_today BETWEEN ir.start_date AND ir.end_date
      AND public.incentive_rule_matches_driver(ir.id, v_driver_id)
    ORDER BY ir.priority DESC, ir.created_at ASC
  LOOP
    v_eligible := COALESCE(
      public.count_eligible_deliveries(v_driver_id, v_today, v_rule.id),
      0
    );
    v_progress := COALESCE(
      public.count_progress_deliveries(v_driver_id, v_today, v_rule.id),
      0
    );

    IF v_rule.target_mode = 'tiered' THEN
      SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
      INTO v_target
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id;
    ELSE
      v_target := COALESCE(v_rule.target_deliveries, 0);
    END IF;

    v_remaining := GREATEST(0, v_target - v_progress);

    v_full_reward := COALESCE(
      v_rule.reward_kwd,
      public.compute_incentive_amount(v_rule.id, v_target, v_today),
      0
    );

    v_current_reward := COALESCE(
      public.compute_incentive_amount(v_rule.id, v_eligible, v_today),
      0
    );

    v_band_start := public._incentive_band_start(v_rule.id, v_today);
    v_band_fields := jsonb_build_object('band_start', NULL);
    IF v_band_start IS NOT NULL THEN
      v_cur_threshold := NULL;
      v_cur_rate := NULL;
      v_next_rate := NULL;

      SELECT t.threshold_deliveries, t.reward_per_delivery_kwd
      INTO v_cur_threshold, v_cur_rate
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id
        AND t.threshold_deliveries > GREATEST(v_eligible, v_band_start)
      ORDER BY t.threshold_deliveries ASC
      LIMIT 1;

      IF v_cur_threshold IS NOT NULL THEN
        SELECT t.reward_per_delivery_kwd
        INTO v_next_rate
        FROM public.incentive_rule_tiers t
        WHERE t.incentive_rule_id = v_rule.id
          AND t.threshold_deliveries > v_cur_threshold
        ORDER BY t.threshold_deliveries ASC
        LIMIT 1;
      END IF;

      v_band_fields := jsonb_build_object(
        'band_start', v_band_start,
        'locked', v_eligible < v_band_start,
        'extra_orders', GREATEST(0, v_eligible - v_band_start),
        'current_rate_kwd', v_cur_rate,
        'next_rate_kwd', v_next_rate,
        'orders_to_next_rate',
          CASE WHEN v_next_rate IS NOT NULL
               THEN v_cur_threshold - GREATEST(v_eligible, v_band_start)
          END
      );
    END IF;

    v_scope_label := NULL;
    CASE v_rule.scope_type
      WHEN 'restaurant' THEN
        SELECT string_agg(r.name, ', ' ORDER BY r.name)
        INTO v_scope_label
        FROM public.incentive_rule_scopes s
        JOIN public.restaurants r ON r.id = s.restaurant_id
        WHERE s.incentive_rule_id = v_rule.id;
      WHEN 'partner' THEN
        SELECT string_agg(p.name, ', ' ORDER BY p.name)
        INTO v_scope_label
        FROM public.incentive_rule_scopes s
        JOIN public.partners p ON p.id = s.partner_id
        WHERE s.incentive_rule_id = v_rule.id;
      WHEN 'zone' THEN
        SELECT string_agg(z.name, ', ' ORDER BY z.name)
        INTO v_scope_label
        FROM public.incentive_rule_scopes s
        JOIN public.zones z ON z.id = s.zone_id
        WHERE s.incentive_rule_id = v_rule.id;
      ELSE
        v_scope_label := NULL;
    END CASE;

    v_offers := v_offers || (jsonb_build_object(
      'rule_id', v_rule.id,
      'name', v_rule.name,
      'display_name', regexp_replace(v_rule.name, '\s+\d{4}-\d{2}-\d{2}$', ''),
      'period', v_rule.period,
      'scope_type', v_rule.scope_type,
      'scope_label', v_scope_label,
      'current_count', v_eligible,
      'progress_count', v_progress,
      'target', v_target,
      'remaining_deliveries', v_remaining,
      'base_minimum_deliveries', COALESCE(v_rule.base_minimum_deliveries, 0),
      'reward_kwd', v_full_reward,
      'current_payout_kwd', v_current_reward,
      'reward_per_delivery_kwd', v_rule.reward_per_delivery_kwd,
      'reward_mode', v_rule.reward_mode,
      'target_mode', v_rule.target_mode,
      'payout_mode', v_rule.payout_mode,
      'start_date', v_rule.start_date,
      'end_date', v_rule.end_date,
      'completed', v_remaining <= 0,
      'tiers', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'threshold', t.threshold_deliveries,
              'reward_kwd', t.reward_kwd,
              'reward_per_delivery_kwd', t.reward_per_delivery_kwd
            )
            ORDER BY t.threshold_deliveries
          )
          FROM public.incentive_rule_tiers t
          WHERE t.incentive_rule_id = v_rule.id
        ),
        '[]'::jsonb
      )
    ) || v_band_fields);
  END LOOP;

  RETURN jsonb_build_object(
    'active_offers', v_offers,
    'daily_dpd', public._driver_daily_dpd_state(v_driver_id, v_today)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;

-- ---------------------------------------------------------------------------
-- Shift notice ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.driver_dpd_shift_notices (
  driver_id uuid NOT NULL REFERENCES public.drivers (id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('warning', 'congrats', 'summary')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid,
  PRIMARY KEY (driver_id, shift_date, kind)
);

COMMENT ON TABLE public.driver_dpd_shift_notices IS
  'One row per DPD shift message sent (warning / congrats / summary) per rider per shift day. The primary key is the at-most-once guard.';

ALTER TABLE public.driver_dpd_shift_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_dpd_shift_notices_staff_read ON public.driver_dpd_shift_notices;
CREATE POLICY driver_dpd_shift_notices_staff_read
  ON public.driver_dpd_shift_notices
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

REVOKE ALL ON public.driver_dpd_shift_notices FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.driver_dpd_shift_notices FROM authenticated;
GRANT SELECT ON public.driver_dpd_shift_notices TO authenticated;
GRANT ALL ON public.driver_dpd_shift_notices TO service_role;

CREATE OR REPLACE FUNCTION public.claim_dpd_shift_notice(
  p_driver_id uuid,
  p_shift_date date,
  p_kind text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.driver_dpd_shift_notices (driver_id, shift_date, kind)
  VALUES (p_driver_id, p_shift_date, p_kind)
  ON CONFLICT (driver_id, shift_date, kind) DO NOTHING
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_dpd_notice_candidates(
  p_now timestamptz DEFAULT now(),
  p_driver_ids uuid[] DEFAULT NULL,
  p_kinds text[] DEFAULT NULL
)
RETURNS TABLE (
  driver_id uuid,
  shift_date date,
  kind text,
  target integer,
  completed integer,
  incentive_kwd numeric,
  minutes_left integer,
  locale text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_today date := (p_now AT TIME ZONE 'Asia/Kuwait')::date;
  c record;
  v_shift public.driver_daily_shifts%ROWTYPE;
  v_end timestamptz;
  v_state jsonb;
  v_target int;
  v_completed int;
  v_incentive numeric;
  v_closed boolean;
BEGIN
  FOR c IN
    SELECT DISTINCT x.driver_id, x.day
    FROM (
      SELECT s.driver_id, s.shift_date AS day
      FROM public.driver_daily_shifts s
      WHERE s.shift_date IN (v_today, v_today - 1)
      UNION
      SELECT a.driver_id, a.log_date
      FROM public.attendance_logs a
      WHERE a.log_date = v_today
      UNION
      SELECT unnest(p_driver_ids), v_today
    ) x
    JOIN public.drivers d ON d.id = x.driver_id
    WHERE d.archived_at IS NULL
      AND d.status = 'active'
      AND COALESCE(d.is_blocked, false) = false
      AND (p_driver_ids IS NULL OR x.driver_id = ANY (p_driver_ids))
  LOOP
    v_state := public._driver_daily_dpd_state(c.driver_id, c.day);
    CONTINUE WHEN v_state IS NULL;
    v_target := (v_state->>'target')::int;
    v_completed := (v_state->>'completed_today')::int;
    CONTINUE WHEN v_target IS NULL OR v_target <= 0;

    SELECT * INTO v_shift
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = c.driver_id AND s.shift_date = c.day
    LIMIT 1;
    v_end := CASE WHEN v_shift.id IS NOT NULL THEN public._driver_shift_end_at(v_shift) END;

    -- Yesterday only matters for a shift that ended within the last 6 hours.
    IF c.day < v_today AND (v_end IS NULL OR p_now > v_end + interval '6 hours') THEN
      CONTINUE;
    END IF;

    driver_id := c.driver_id;
    shift_date := c.day;
    target := v_target;
    completed := v_completed;
    SELECT p.locale INTO locale FROM public.profiles p WHERE p.id = c.driver_id;

    IF (p_kinds IS NULL OR 'warning' = ANY (p_kinds))
       AND v_end IS NOT NULL
       AND p_now >= v_end - interval '30 minutes'
       AND p_now < v_end
       AND v_completed < v_target
       AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = c.driver_id AND d.is_on_duty)
       AND NOT EXISTS (
         SELECT 1 FROM public.driver_dpd_shift_notices n
         WHERE n.driver_id = c.driver_id AND n.shift_date = c.day AND n.kind = 'warning'
       ) THEN
      kind := 'warning';
      incentive_kwd := 0;
      minutes_left := GREATEST(1, ceil(extract(epoch FROM (v_end - p_now)) / 60)::int);
      RETURN NEXT;
    END IF;

    IF (p_kinds IS NULL OR 'congrats' = ANY (p_kinds))
       AND c.day = v_today
       AND v_completed >= v_target
       AND NOT EXISTS (
         SELECT 1 FROM public.driver_dpd_shift_notices n
         WHERE n.driver_id = c.driver_id AND n.shift_date = c.day AND n.kind = 'congrats'
       ) THEN
      kind := 'congrats';
      incentive_kwd := 0;
      minutes_left := NULL;
      RETURN NEXT;
    END IF;

    IF p_kinds IS NULL OR 'summary' = ANY (p_kinds) THEN
      SELECT e.incentive_kwd INTO v_incentive
      FROM public.driver_earnings_daily e
      WHERE e.driver_id = c.driver_id AND e.earn_date = c.day;

      v_closed := (v_end IS NOT NULL AND p_now >= v_end)
        OR (
          NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = c.driver_id AND d.is_on_duty)
          AND EXISTS (
            SELECT 1 FROM public.attendance_logs a
            WHERE a.driver_id = c.driver_id
              AND a.log_date = c.day
              AND a.check_out_at IS NOT NULL
          )
          AND (v_end IS NULL OR p_now >= v_end - interval '30 minutes')
        );

      IF v_closed
         AND COALESCE(v_incentive, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM public.driver_dpd_shift_notices n
           WHERE n.driver_id = c.driver_id AND n.shift_date = c.day AND n.kind = 'summary'
         ) THEN
        kind := 'summary';
        incentive_kwd := v_incentive;
        minutes_left := NULL;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._restaurant_daily_dpd_target(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._incentive_band_start(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._driver_daily_dpd_state(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_dpd_shift_notice(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_dpd_notice_candidates(timestamptz, uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._restaurant_daily_dpd_target(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._incentive_band_start(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._driver_daily_dpd_state(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_dpd_shift_notice(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dpd_notice_candidates(timestamptz, uuid[], text[]) TO service_role;
