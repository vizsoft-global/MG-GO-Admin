-- Outsource company DPD target + incentive scheme (SOP v1.0, client-approved).
--
-- An outsourced rider whose `source_companies` row has an `effective_from`
-- reached on/before `earn_date` is governed by the company's own config
-- instead of restaurant `incentive_rules`:
--
--   * company_config_applies(driver, on_date) = outsourced + source_company
--     present + effective_from IS NOT NULL + on_date >= effective_from.
--   * When it applies, restaurant incentive_rules are skipped for that day.
--   * incentive_enabled + rates => flat above/below per-order scheme over the
--     rider's verified count across ALL restaurants (never
--     delivery_matches_rules); signed net (below target is a deduction).
--   * incentive_enabled = false => incentive 0 and no offers (no incentive).
--   * dpd_target set => company target drives the Daily DPD card; target NULL
--     => the DPD card is hidden (NO restaurant fallback — company DPD is
--     independent, per the SOP).
--   * Unassigned outsourced (source_company NULL) and in-house riders keep the
--     existing restaurant behaviour unchanged.
--
-- Verified count formula (Excel "Total Orders"): max(0, n-T)*above and
-- -max(0, T-n)*below. n = 0 with a scheme => full deduction T*below.
--
-- Seed: only `sadeeq` ships ON (T = 15, +0.100 / -0.350). Every other
-- non-system company seeds incentive OFF with effective_from = migration day,
-- so "no incentive by default" (client requirement 1) holds from the cutover
-- until Ops sets a target/rates. `mg` (system) is locked and untouched.
--
-- No existing `driver_earnings_daily` row is recalculated; a recalc follows
-- the company scheme only for `earn_date >= effective_from`.

-- ---------------------------------------------------------------------------
-- Columns + constraints
-- ---------------------------------------------------------------------------

ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS dpd_target integer,
  ADD COLUMN IF NOT EXISTS incentive_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incentive_above_kwd numeric(10, 3),
  ADD COLUMN IF NOT EXISTS incentive_below_kwd numeric(10, 3),
  ADD COLUMN IF NOT EXISTS effective_from date;

ALTER TABLE public.source_companies DROP CONSTRAINT IF EXISTS source_companies_dpd_target_chk;
ALTER TABLE public.source_companies
  ADD CONSTRAINT source_companies_dpd_target_chk
  CHECK (dpd_target IS NULL OR dpd_target > 0);

-- Enabled => target + both rates + a start date. Disabled => rates must be
-- NULL (a half-configured scheme is unrepresentable rather than silently
-- applied). dpd_target / effective_from stay free in both states so a company
-- can be "DPD only" (target + date, incentive OFF) before Ops enables rates.
ALTER TABLE public.source_companies DROP CONSTRAINT IF EXISTS source_companies_incentive_fields_chk;
ALTER TABLE public.source_companies
  ADD CONSTRAINT source_companies_incentive_fields_chk
  CHECK (
    (incentive_enabled = true
       AND dpd_target IS NOT NULL AND dpd_target > 0
       AND incentive_above_kwd IS NOT NULL
       AND incentive_below_kwd IS NOT NULL
       AND effective_from IS NOT NULL)
    OR
    (incentive_enabled = false
       AND incentive_above_kwd IS NULL
       AND incentive_below_kwd IS NULL)
  );

COMMENT ON COLUMN public.source_companies.dpd_target IS
  'Daily DPD target for this company''s outsourced riders (applies when effective_from is reached).';
COMMENT ON COLUMN public.source_companies.incentive_enabled IS
  'Whether this company pays a flat above/below per-order scheme instead of restaurant incentive_rules.';
COMMENT ON COLUMN public.source_companies.incentive_above_kwd IS
  'Per-order bonus above the DPD target.';
COMMENT ON COLUMN public.source_companies.incentive_below_kwd IS
  'Per-order deduction below the DPD target.';
COMMENT ON COLUMN public.source_companies.effective_from IS
  'Kuwait date the company config (DPD target and/or scheme) replaces restaurant incentives. NULL = restaurant behaviour continues.';

-- ---------------------------------------------------------------------------
-- Guard: the system company's scheme fields are locked like the rest of it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.source_companies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source_company_delete_forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'source_company_key_immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_system AND (
      NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.client_code IS DISTINCT FROM OLD.client_code
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.is_system IS DISTINCT FROM OLD.is_system
      OR NEW.dpd_target IS DISTINCT FROM OLD.dpd_target
      OR NEW.incentive_enabled IS DISTINCT FROM OLD.incentive_enabled
      OR NEW.incentive_above_kwd IS DISTINCT FROM OLD.incentive_above_kwd
      OR NEW.incentive_below_kwd IS DISTINCT FROM OLD.incentive_below_kwd
      OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    ) THEN
      RAISE EXCEPTION 'source_company_system_locked' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active AND (
      EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.source_company = OLD.key AND d.archived_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.driver_intakes i
        WHERE i.source_company = OLD.key AND i.archived_at IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'source_company_in_use' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_companies_guard_trg ON public.source_companies;
CREATE TRIGGER source_companies_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.source_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.source_companies_guard();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether an outsourced rider is governed by their company's config on a date.
CREATE OR REPLACE FUNCTION public.company_config_applies(
  p_driver_id uuid,
  p_on_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drivers d
    JOIN public.source_companies sc ON sc.key = d.source_company
    WHERE d.id = p_driver_id
      AND d.rider_category = 'outsourced'
      AND sc.effective_from IS NOT NULL
      AND p_on_date >= sc.effective_from
  );
$$;

REVOKE ALL ON FUNCTION public.company_config_applies(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_config_applies(uuid, date) TO service_role;

-- Flat above/below per-order scheme (mirrors the SOP Excel).
CREATE OR REPLACE FUNCTION public.compute_source_company_incentive(
  p_orders integer,
  p_target integer,
  p_above numeric,
  p_below numeric
)
RETURNS TABLE (
  incentive_kwd numeric,
  deduction_kwd numeric,
  net_kwd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN COALESCE(p_orders, 0) > p_target
         THEN (COALESCE(p_orders, 0) - p_target) * COALESCE(p_above, 0)
         ELSE 0
    END AS incentive_kwd,
    CASE WHEN COALESCE(p_orders, 0) < p_target
         THEN (p_target - COALESCE(p_orders, 0)) * COALESCE(p_below, 0)
         ELSE 0
    END AS deduction_kwd,
    CASE
      WHEN COALESCE(p_orders, 0) > p_target
        THEN (COALESCE(p_orders, 0) - p_target) * COALESCE(p_above, 0)
      WHEN COALESCE(p_orders, 0) < p_target
        THEN -((p_target - COALESCE(p_orders, 0)) * COALESCE(p_below, 0))
      ELSE 0
    END AS net_kwd
$$;

REVOKE ALL ON FUNCTION public.compute_source_company_incentive(integer, integer, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_source_company_incentive(integer, integer, numeric, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- admin_upsert_source_company: + scheme params + validation.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_upsert_source_company(text, text, text, boolean, integer);

CREATE OR REPLACE FUNCTION public.admin_upsert_source_company(
  p_key text,
  p_name text,
  p_client_code text,
  p_is_active boolean,
  p_sort_order integer DEFAULT NULL,
  p_dpd_target integer DEFAULT NULL,
  p_incentive_enabled boolean DEFAULT false,
  p_incentive_above_kwd numeric DEFAULT NULL,
  p_incentive_below_kwd numeric DEFAULT NULL,
  p_effective_from date DEFAULT NULL
)
RETURNS public.source_companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(upper(btrim(coalesce(p_client_code, ''))), '');
  v_target integer := p_dpd_target;
  v_enabled boolean := coalesce(p_incentive_enabled, false);
  v_above numeric := p_incentive_above_kwd;
  v_below numeric := p_incentive_below_kwd;
  v_effective date := p_effective_from;
  v_row public.source_companies;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.companies_can_write() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_key !~ '^[a-z0-9_]{1,24}$' THEN
    RAISE EXCEPTION 'invalid_company_key' USING ERRCODE = 'P0001';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[A-Z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_client_code' USING ERRCODE = 'P0001';
  END IF;
  IF v_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.source_companies c
    WHERE c.client_code = v_code AND c.key <> v_key
  ) THEN
    RAISE EXCEPTION 'client_code_taken' USING ERRCODE = 'P0001';
  END IF;

  IF v_target IS NOT NULL AND v_target <= 0 THEN
    RAISE EXCEPTION 'invalid_dpd_target' USING ERRCODE = 'P0001';
  END IF;

  IF v_enabled THEN
    IF v_target IS NULL OR v_target <= 0 THEN
      RAISE EXCEPTION 'invalid_dpd_target' USING ERRCODE = 'P0001';
    END IF;
    IF v_above IS NULL OR v_above <= 0 THEN
      RAISE EXCEPTION 'invalid_incentive_rate' USING ERRCODE = 'P0001';
    END IF;
    IF v_below IS NULL OR v_below <= 0 THEN
      RAISE EXCEPTION 'invalid_incentive_rate' USING ERRCODE = 'P0001';
    END IF;
    IF v_effective IS NULL THEN
      RAISE EXCEPTION 'incentive_effective_from_required' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_above := NULL;
    v_below := NULL;
  END IF;

  INSERT INTO public.source_companies AS c (
    key, name, client_code, is_active, sort_order,
    dpd_target, incentive_enabled, incentive_above_kwd, incentive_below_kwd, effective_from
  )
  VALUES (
    v_key, v_name, v_code, coalesce(p_is_active, true), coalesce(p_sort_order, 100),
    v_target, v_enabled, v_above, v_below, v_effective
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        client_code = EXCLUDED.client_code,
        is_active = EXCLUDED.is_active,
        sort_order = coalesce(p_sort_order, c.sort_order),
        dpd_target = EXCLUDED.dpd_target,
        incentive_enabled = EXCLUDED.incentive_enabled,
        incentive_above_kwd = EXCLUDED.incentive_above_kwd,
        incentive_below_kwd = EXCLUDED.incentive_below_kwd,
        effective_from = EXCLUDED.effective_from
  RETURNING c.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer, integer, boolean, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_source_company(text, text, text, boolean, integer, integer, boolean, numeric, numeric, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- recalculate_driver_earnings: company scheme bypasses incentive_rules.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_driver_earnings(
  p_driver_id uuid,
  p_earn_date date,
  p_approved_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deliveries int;
  v_incentive numeric(10, 3) := 0;
  v_base numeric(10, 3) := 0;
  v_loan numeric(10, 3) := 0;
  v_penalty numeric(10, 3) := 0;
  v_reimb numeric(10, 3) := 0;
  v_net numeric(10, 3);
  v_rule record;
  v_eligible_count int;
  v_existing record;
  v_rule_amount numeric(10, 3);
  v_override_amount numeric(10, 3) := -1;
  v_override_priority int := -1;
  v_override_rule_id uuid;
  v_breakdown jsonb := '[]'::jsonb;
  v_tier_lines jsonb := '[]'::jsonb;
  v_accrues boolean;
  v_company_key text;
  v_company_name text;
  v_company_enabled boolean;
  v_company_target int;
  v_company_above numeric(10, 3);
  v_company_below numeric(10, 3);
  v_company_incentive numeric(10, 3);
  v_company_deduction numeric(10, 3);
  v_company_net numeric(10, 3);
BEGIN
  SELECT COALESCE(base_earnings_kwd, 0) INTO v_base
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT deliveries, loan_deduction_kwd, penalty_kwd, reimbursement_kwd
  INTO v_existing
  FROM public.driver_earnings_daily
  WHERE driver_id = p_driver_id AND earn_date = p_earn_date;

  IF FOUND THEN
    v_loan := COALESCE(v_existing.loan_deduction_kwd, 0);
    v_penalty := COALESCE(v_existing.penalty_kwd, 0);
    v_reimb := COALESCE(v_existing.reimbursement_kwd, 0);
  END IF;

  IF public.company_config_applies(p_driver_id, p_earn_date) THEN
    SELECT sc.key, sc.name, sc.incentive_enabled, sc.dpd_target,
           sc.incentive_above_kwd, sc.incentive_below_kwd
    INTO v_company_key, v_company_name, v_company_enabled,
         v_company_target, v_company_above, v_company_below
    FROM public.drivers d
    JOIN public.source_companies sc ON sc.key = d.source_company
    WHERE d.id = p_driver_id;

    -- Verified across all restaurants — never restaurant rule matching.
    SELECT count(*)::int INTO v_deliveries
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date;

    v_incentive := 0;
    v_breakdown := '[]'::jsonb;
    IF v_company_enabled THEN
      SELECT x.incentive_kwd, x.deduction_kwd, x.net_kwd
      INTO v_company_incentive, v_company_deduction, v_company_net
      FROM public.compute_source_company_incentive(
        v_deliveries, v_company_target, v_company_above, v_company_below
      ) x;

      v_incentive := v_company_net;
      v_breakdown := jsonb_build_array(jsonb_build_object(
        'kind', 'source_company',
        'company_key', v_company_key,
        'company_name', v_company_name,
        'deliveries', v_deliveries,
        'target', v_company_target,
        'above_kwd', v_company_above,
        'below_kwd', v_company_below,
        'incentive_kwd', v_company_incentive,
        'deduction_kwd', v_company_deduction,
        'net_kwd', v_company_net
      ));
    END IF;
  ELSE
    SELECT count(*)::int INTO v_deliveries
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
      AND public.delivery_matches_rules(d.id, p_earn_date);

    FOR v_rule IN
      SELECT ir.*
      FROM public.incentive_rules ir
      WHERE public.incentive_rule_applies_on_date(ir.id, p_earn_date)
      ORDER BY
        CASE WHEN ir.status = 'active' THEN 0 ELSE 1 END,
        ir.priority DESC,
        CASE WHEN ir.status = 'active' THEN ir.created_at END ASC NULLS LAST,
        ir.created_at DESC,
        ir.id DESC
    LOOP
      v_accrues := public.incentive_accrues_on_date(v_rule.period, p_earn_date);

      v_eligible_count := public.count_eligible_deliveries(
        p_driver_id,
        p_earn_date,
        v_rule.id
      );

      v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count, p_earn_date);

      IF NOT v_accrues THEN
        v_rule_amount := 0;
      END IF;

      IF v_rule.overrides_others AND v_rule_amount > 0 AND v_rule.priority > v_override_priority THEN
        v_override_amount := v_rule_amount;
        v_override_priority := v_rule.priority;
        v_override_rule_id := v_rule.id;
      END IF;

      IF v_rule_amount > 0 OR (v_accrues AND v_eligible_count > 0) THEN
        v_tier_lines := '[]'::jsonb;
        IF v_rule.target_mode = 'tiered' THEN
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'threshold', t.threshold_deliveries,
                'reward_mode', t.reward_mode,
                'met', v_eligible_count >= t.threshold_deliveries
              )
              ORDER BY t.threshold_deliveries
            ),
            '[]'::jsonb
          )
          INTO v_tier_lines
          FROM public.incentive_rule_tiers t
          WHERE t.incentive_rule_id = v_rule.id;
        END IF;

        v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'period', v_rule.period,
          'eligible_count', v_eligible_count,
          'target_mode', v_rule.target_mode,
          'base_minimum', v_rule.base_minimum_deliveries,
          'target', v_rule.target_deliveries,
          'reward_mode', v_rule.reward_mode,
          'payout_mode', v_rule.payout_mode,
          'overrides_others', v_rule.overrides_others,
          'priority', v_rule.priority,
          'amount_kwd', v_rule_amount,
          'accrues_on_date', v_accrues,
          'tiers', v_tier_lines
        ));
      END IF;

      v_incentive := v_incentive + v_rule_amount;
    END LOOP;

    IF v_override_amount >= 0 THEN
      v_incentive := v_override_amount;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'override_rule_id', v_override_rule_id,
        'note', 'override_applied',
        'final_incentive_kwd', v_override_amount
      ));
    END IF;
  END IF;

  v_net := v_base + v_incentive - v_loan - v_penalty + v_reimb;

  INSERT INTO public.driver_earnings_daily (
    driver_id,
    earn_date,
    deliveries,
    base_kwd,
    incentive_kwd,
    loan_deduction_kwd,
    penalty_kwd,
    reimbursement_kwd,
    net_kwd,
    breakdown,
    calculated_at,
    updated_at
  )
  VALUES (
    p_driver_id,
    p_earn_date,
    v_deliveries,
    v_base,
    v_incentive,
    v_loan,
    v_penalty,
    v_reimb,
    v_net,
    COALESCE(v_breakdown, '[]'::jsonb),
    now(),
    now()
  )
  ON CONFLICT (driver_id, earn_date) DO UPDATE SET
    deliveries = EXCLUDED.deliveries,
    base_kwd = EXCLUDED.base_kwd,
    incentive_kwd = EXCLUDED.incentive_kwd,
    net_kwd = EXCLUDED.net_kwd,
    breakdown = EXCLUDED.breakdown,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  PERFORM public.sync_driver_wallet_earning_credit(p_driver_id, p_earn_date, p_approved_by);
END;
$$;

-- ---------------------------------------------------------------------------
-- _driver_daily_dpd_state: company target when the company config applies.
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
  v_progress int := 0;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_company_name text;
BEGIN
  IF p_driver_id IS NULL OR p_on_date IS NULL THEN
    RETURN NULL;
  END IF;

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
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_on_date;

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND COALESCE(
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
        (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
      ) = p_on_date;

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
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_on_date;

    SELECT count(*)::int INTO v_progress
    FROM public.deliveries d
    WHERE d.driver_id = p_driver_id
      AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
      AND d.restaurant_id = v_restaurant_id
      AND COALESCE(
        (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
        (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
      ) = p_on_date;
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
$$;

REVOKE ALL ON FUNCTION public._driver_daily_dpd_state(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._driver_daily_dpd_state(uuid, date) TO service_role;

-- ---------------------------------------------------------------------------
-- driver_get_extra_earnings: company scheme replaces active offers.
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
  v_company jsonb := 'null'::jsonb;
  v_company_name text;
  v_company_enabled boolean;
  v_company_target int;
  v_company_above numeric;
  v_company_below numeric;
  v_company_completed int;
  v_company_progress int;
  v_company_incentive numeric;
  v_company_deduction numeric;
  v_company_net numeric;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_driver_id) THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;

  IF public.company_config_applies(v_driver_id, v_today) THEN
    SELECT sc.name, sc.incentive_enabled, sc.dpd_target,
           sc.incentive_above_kwd, sc.incentive_below_kwd
    INTO v_company_name, v_company_enabled, v_company_target,
         v_company_above, v_company_below
    FROM public.drivers d
    JOIN public.source_companies sc ON sc.key = d.source_company
    WHERE d.id = v_driver_id;

    IF v_company_enabled THEN
      SELECT count(*)::int INTO v_company_completed
      FROM public.deliveries d
      WHERE d.driver_id = v_driver_id
        AND d.status = 'verified'
        AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_today;

      SELECT count(*)::int INTO v_company_progress
      FROM public.deliveries d
      WHERE d.driver_id = v_driver_id
        AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
        AND COALESCE(
          (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
          (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
        ) = v_today;

      SELECT x.incentive_kwd, x.deduction_kwd, x.net_kwd
      INTO v_company_incentive, v_company_deduction, v_company_net
      FROM public.compute_source_company_incentive(
        v_company_completed, v_company_target, v_company_above, v_company_below
      ) x;

      v_company := jsonb_build_object(
        'company_name', v_company_name,
        'target', v_company_target,
        'above_kwd', v_company_above,
        'below_kwd', v_company_below,
        'completed_today', v_company_completed,
        'progress_today', v_company_progress,
        'incentive_kwd', v_company_incentive,
        'deduction_kwd', v_company_deduction,
        'net_kwd', v_company_net
      );
    END IF;
  ELSE
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
  END IF;

  RETURN jsonb_build_object(
    'active_offers', v_offers,
    'daily_dpd', public._driver_daily_dpd_state(v_driver_id, v_today),
    'company_scheme', v_company
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;

-- ---------------------------------------------------------------------------
-- driver_get_home_dashboard: no weekly incentive banner for company riders.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_get_home_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_today date;
  v_week_start date;
  v_week_end date;
  v_driver jsonb;
  v_session jsonb;
  v_week jsonb;
  v_incentive jsonb := 'null'::jsonb;
  v_rules jsonb := '[]'::jsonb;
  v_rule record;
  v_eligible int;
  v_progress int;
  v_target int;
  v_remaining int;
  v_reward numeric(10, 3);
  v_tiers jsonb;
  v_earnings numeric(10, 3);
  v_deliveries int;
  v_online_seconds bigint;
  v_is_online boolean := false;
  v_went_online_at timestamptz;
  v_speed_mps numeric(8, 3);
  v_distance_today_meters numeric(12, 2);
  v_shift_adherence jsonb;
  v_performance jsonb;
  v_banner jsonb;
  v_force_at timestamptz;
  v_force_min int;
  v_force_app_update boolean := false;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_driver_id) THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_week_start := public.kuwait_week_start(v_today);
  v_week_end := v_today;

  SELECT jsonb_build_object(
    'full_name', COALESCE(pr.full_name, 'Driver'),
    'is_on_duty', dr.is_on_duty,
    'partner_name', pt.name,
    'partner_logo_url', pt.logo_url
  ),
  dr.force_app_update_at,
  dr.force_app_update_min_code
  INTO v_driver, v_force_at, v_force_min
  FROM public.drivers dr
  JOIN public.profiles pr ON pr.id = dr.id
  LEFT JOIN public.partners pt ON pt.id = dr.partner_id
  WHERE dr.id = v_driver_id;

  v_force_app_update := v_force_at IS NOT NULL AND v_force_min IS NOT NULL;

  SELECT ds.is_online, ds.went_online_at
  INTO v_is_online, v_went_online_at
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
  ORDER BY ds.updated_at DESC NULLS LAST, ds.created_at DESC
  LIMIT 1;

  v_is_online := COALESCE(v_is_online, false);

  SELECT dl.speed_mps, dl.distance_today_meters
  INTO v_speed_mps, v_distance_today_meters
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_driver_id;

  v_session := jsonb_build_object(
    'is_online', v_is_online,
    'went_online_at', v_went_online_at,
    'speed_mps', v_speed_mps,
    'distance_today_meters', COALESCE(v_distance_today_meters, 0)
  );

  SELECT COALESCE(SUM(w.amount_kwd), 0)
  INTO v_earnings
  FROM public.driver_wallet_entries w
  WHERE w.driver_id = v_driver_id
    AND w.status = 'approved'
    AND w.entry_type = 'earning_credit'
    AND w.earn_date BETWEEN v_week_start AND v_week_end;

  SELECT count(*)::int
  INTO v_deliveries
  FROM public.deliveries d
  WHERE d.driver_id = v_driver_id
    AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
    AND COALESCE(
      d.shift_date,
      (COALESCE(d.delivered_at, d.pickup_at) AT TIME ZONE 'Asia/Kuwait')::date
    ) BETWEEN v_week_start AND v_week_end;

  v_online_seconds := public.driver_week_online_seconds(
    v_driver_id,
    v_week_start,
    v_today
  );

  v_week := jsonb_build_object(
    'start_date', v_week_start,
    'end_date', v_week_end,
    'earnings_kwd', v_earnings,
    'deliveries_count', v_deliveries,
    'online_seconds', v_online_seconds
  );

  IF NOT public.company_config_applies(v_driver_id, v_today) THEN
    SELECT ir.*
    INTO v_rule
    FROM public.incentive_rules ir
    WHERE ir.status = 'active'
      AND ir.period = 'weekly'
      AND v_today BETWEEN ir.start_date AND ir.end_date
      AND public.incentive_rule_matches_driver(ir.id, v_driver_id)
    ORDER BY ir.priority DESC, ir.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      v_eligible := public.count_eligible_deliveries(v_driver_id, v_today, v_rule.id);
      v_progress := public.count_progress_deliveries(v_driver_id, v_today, v_rule.id);

      IF v_rule.target_mode = 'tiered' THEN
        SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
        INTO v_target
        FROM public.incentive_rule_tiers t
        WHERE t.incentive_rule_id = v_rule.id;
      ELSE
        v_target := COALESCE(v_rule.target_deliveries, 0);
      END IF;

      v_remaining := GREATEST(0, v_target - v_progress);
      v_reward := COALESCE(
        v_rule.reward_kwd,
        public.compute_incentive_amount(v_rule.id, v_target),
        0
      );

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'threshold', t.threshold_deliveries,
            'reward_kwd', t.reward_kwd,
            'reward_per_delivery_kwd', t.reward_per_delivery_kwd,
            'reward_mode', t.reward_mode
          )
          ORDER BY t.threshold_deliveries
        ),
        '[]'::jsonb
      )
      INTO v_tiers
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id;

      v_incentive := jsonb_build_object(
        'rule_id', v_rule.id,
        'name', v_rule.name,
        'eligible_count', v_eligible,
        'progress_count', v_progress,
        'target', v_target,
        'reward_kwd', v_reward,
        'remaining_deliveries', v_remaining,
        'target_mode', v_rule.target_mode,
        'tiers', v_tiers
      );
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', dr.id,
        'name', dr.name,
        'scope_type', dr.scope_type,
        'restaurant_name', r.name,
        'start_date', dr.start_date,
        'end_date', dr.end_date,
        'summary', CASE
          WHEN dr.scope_type = 'restaurant' AND r.name IS NOT NULL THEN
            'Verified deliveries from ' || r.name || ' count toward incentives'
          WHEN dr.scope_type = 'partner' THEN
            'Verified deliveries for this partner count toward incentives'
          WHEN dr.scope_type = 'zone' THEN
            'Verified deliveries in your zone count toward incentives'
          ELSE dr.name
        END
      )
      ORDER BY dr.priority DESC, dr.name
    ),
    '[]'::jsonb
  )
  INTO v_rules
  FROM public.delivery_rules dr
  LEFT JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
  LEFT JOIN public.restaurants r ON r.id = s.restaurant_id
  WHERE dr.status = 'active'
    AND v_today BETWEEN dr.start_date AND dr.end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s2
      JOIN public.drivers drv ON drv.id = v_driver_id
      WHERE s2.delivery_rule_id = dr.id
        AND (
          (dr.scope_type = 'zone' AND s2.zone_id = drv.zone_id)
          OR (dr.scope_type = 'partner' AND s2.partner_id = drv.partner_id)
          OR (
            dr.scope_type = 'restaurant'
            AND s2.restaurant_id IN (
              SELECT dr3.restaurant_id
              FROM public.driver_restaurants dr3
              WHERE dr3.driver_id = v_driver_id
            )
          )
        )
    );

  v_shift_adherence := public._driver_shift_adherence(v_driver_id, v_today);
  v_performance := public.driver_delivery_performance_counts(v_driver_id);
  v_banner := public._driver_home_banner_for(v_driver_id);

  RETURN jsonb_build_object(
    'driver', v_driver,
    'session', v_session,
    'week', v_week,
    'primary_weekly_incentive', v_incentive,
    'delivery_rules', v_rules,
    'shift_adherence', v_shift_adherence,
    'performance', v_performance,
    'banner', v_banner,
    'force_app_update', v_force_app_update,
    'force_app_update_min_code', v_force_min
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Seed: Sadeeq ships ON with the approved scheme. Every other non-system
-- company ships incentive OFF with effective_from = migration day, so
-- restaurant incentives stop at the cutover ("no incentive by default") until
-- Ops sets a target/rates. mg (system) is untouched and locked.
-- ---------------------------------------------------------------------------

UPDATE public.source_companies
SET dpd_target = 15,
    incentive_enabled = true,
    incentive_above_kwd = 0.100,
    incentive_below_kwd = 0.350,
    effective_from = (now() AT TIME ZONE 'Asia/Kuwait')::date
WHERE key = 'sadeeq'
  AND is_system = false
  AND incentive_enabled = false
  AND incentive_above_kwd IS NULL
  AND incentive_below_kwd IS NULL
  AND effective_from IS NULL;

UPDATE public.source_companies
SET incentive_enabled = false,
    incentive_above_kwd = NULL,
    incentive_below_kwd = NULL,
    effective_from = (now() AT TIME ZONE 'Asia/Kuwait')::date
WHERE is_system = false
  AND key <> 'sadeeq'
  AND incentive_enabled = false
  AND incentive_above_kwd IS NULL
  AND incentive_below_kwd IS NULL
  AND effective_from IS NULL;

-- ---------------------------------------------------------------------------
-- Performance DPD/Outsource: company dpd_target (null if unset — never
-- restaurant) once a company config applies. Rewrites the two read RPCs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_dpd_efficiency_snapshot(
  p_from date,
  p_to date,
  p_restaurant_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_from := p_from;
  v_to := p_to;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
  IF (v_to - v_from) > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_start := (v_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_end := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  RETURN (
    WITH restaurant_targets AS (
      SELECT DISTINCT ON (restaurant_id)
        restaurant_id,
        dpd_target,
        dpd_period,
        rule_id
      FROM (
        SELECT
          s.restaurant_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id AS rule_id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND s.restaurant_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT
          dr.restaurant_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.status = 'active'
          AND dr.scope_type = 'restaurant'
          AND dr.restaurant_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
      ) x
      ORDER BY restaurant_id, priority DESC, created_at ASC
    ),
    zone_targets AS (
      SELECT DISTINCT ON (zone_id)
        zone_id,
        dpd_target,
        dpd_period,
        rule_id
      FROM (
        SELECT
          s.zone_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id AS rule_id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
        WHERE dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND s.zone_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
        UNION ALL
        SELECT
          dr.zone_id,
          dr.dpd_target,
          dr.dpd_period,
          dr.id,
          dr.priority,
          dr.created_at
        FROM public.delivery_rules dr
        WHERE dr.status = 'active'
          AND dr.scope_type = 'zone'
          AND dr.zone_id IS NOT NULL
          AND dr.dpd_target IS NOT NULL
          AND dr.dpd_target > 0
          AND v_to BETWEEN dr.start_date AND dr.end_date
      ) x
      ORDER BY zone_id, priority DESC, created_at ASC
    ),
    verified AS (
      SELECT
        d.driver_id,
        d.restaurant_id,
        COUNT(*)::integer AS actual
      FROM public.deliveries d
      WHERE d.status = 'verified'
        AND d.delivered_at IS NOT NULL
        AND d.delivered_at >= v_start
        AND d.delivered_at < v_end
        AND (p_restaurant_id IS NULL OR d.restaurant_id = p_restaurant_id)
      GROUP BY d.driver_id, d.restaurant_id
    ),
    actuals AS (
      SELECT driver_id, SUM(actual)::integer AS actual
      FROM verified
      GROUP BY driver_id
    ),
    top_restaurant AS (
      SELECT DISTINCT ON (driver_id)
        driver_id,
        restaurant_id
      FROM verified
      WHERE restaurant_id IS NOT NULL
      ORDER BY driver_id, actual DESC
    ),
    assigned AS (
      SELECT DISTINCT ON (dr.driver_id)
        dr.driver_id,
        dr.restaurant_id
      FROM public.driver_restaurants dr
      ORDER BY dr.driver_id, dr.restaurant_id
    ),
    att AS (
      SELECT
        v.driver_id,
        COUNT(*) FILTER (
          WHERE v.check_in_at IS NOT NULL
            AND v.attendance_status IS DISTINCT FROM 'on_leave'
            AND v.attendance_status IS DISTINCT FROM 'absent'
            AND v.live_status IS DISTINCT FROM 'absent'
        )::integer AS worked_days
      FROM public.v_attendance_daily v
      WHERE v.log_date BETWEEN v_from AND v_to
      GROUP BY v.driver_id
    ),
    riders AS (
      SELECT
        dr.id AS driver_id,
        COALESCE(pr.full_name, '—') AS driver_name,
        dr.employee_id,
        dr.driver_code,
        COALESCE(tr.restaurant_id, asg.restaurant_id) AS restaurant_id,
        r.name AS restaurant_name,
        dr.zone_id,
        z.name AS zone_name,
        COALESCE(a.actual, 0) AS actual,
        COALESCE(a_att.worked_days, 0) AS worked_days,
        CASE
          WHEN ct.applies THEN ct.target::numeric
          WHEN rt.dpd_target IS NOT NULL AND rt.dpd_target > 0 THEN rt.dpd_target
          WHEN zt.dpd_target IS NOT NULL AND zt.dpd_target > 0 THEN zt.dpd_target
          WHEN NULLIF(inc.target_deliveries, 0) IS NOT NULL THEN inc.target_deliveries::numeric
          ELSE NULL
        END AS target
      FROM public.drivers dr
      LEFT JOIN public.profiles pr ON pr.id = dr.id
      LEFT JOIN actuals a ON a.driver_id = dr.id
      LEFT JOIN att a_att ON a_att.driver_id = dr.id
      LEFT JOIN top_restaurant tr ON tr.driver_id = dr.id
      LEFT JOIN assigned asg ON asg.driver_id = dr.id
      LEFT JOIN public.restaurants r
        ON r.id = COALESCE(tr.restaurant_id, asg.restaurant_id)
      LEFT JOIN public.zones z ON z.id = dr.zone_id
      LEFT JOIN restaurant_targets rt
        ON rt.restaurant_id = COALESCE(tr.restaurant_id, asg.restaurant_id)
      LEFT JOIN zone_targets zt ON zt.zone_id = dr.zone_id
      LEFT JOIN LATERAL (
        SELECT t.target_deliveries
        FROM public.admin_resolve_driver_incentive_target(dr.id, v_to) t
      ) inc ON true
      LEFT JOIN LATERAL (
        SELECT sc.dpd_target AS target, true AS applies
        FROM public.source_companies sc
        WHERE dr.rider_category = 'outsourced'
          AND dr.source_company IS NOT NULL
          AND sc.key = dr.source_company
          AND sc.effective_from IS NOT NULL
          AND v_to >= sc.effective_from
      ) ct ON true
      WHERE dr.archived_at IS NULL
        AND (COALESCE(a.actual, 0) > 0 OR COALESCE(a_att.worked_days, 0) > 0)
        AND (p_zone_id IS NULL OR dr.zone_id = p_zone_id)
        AND (p_partner_id IS NULL OR dr.partner_id = p_partner_id)
        AND (
          p_restaurant_id IS NULL
          OR COALESCE(tr.restaurant_id, asg.restaurant_id) = p_restaurant_id
          OR EXISTS (
            SELECT 1 FROM public.driver_restaurants drr
            WHERE drr.driver_id = dr.id AND drr.restaurant_id = p_restaurant_id
          )
        )
    ),
    scored AS (
      SELECT
        r.*,
        CASE
          WHEN r.target IS NULL OR r.target <= 0 THEN NULL
          ELSE r.actual::numeric / r.target
        END AS efficiency,
        CASE
          WHEN r.worked_days > 0 THEN r.actual::numeric / r.worked_days
          ELSE NULL
        END AS dpd_rider
      FROM riders r
    ),
    rider_json AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'driver_id', s.driver_id,
            'driver_name', s.driver_name,
            'employee_id', s.employee_id,
            'driver_code', s.driver_code,
            'restaurant_id', s.restaurant_id,
            'restaurant_name', s.restaurant_name,
            'zone_id', s.zone_id,
            'zone_name', s.zone_name,
            'actual', s.actual,
            'target', s.target,
            'efficiency', s.efficiency,
            'dpd_rider', s.dpd_rider,
            'worked_days', s.worked_days
          )
          ORDER BY s.driver_name
        ),
        '[]'::jsonb
      ) AS rows
      FROM scored s
    ),
    ranked AS (
      SELECT *
      FROM scored
      WHERE efficiency IS NOT NULL
    ),
    top10 AS (
      SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.ord), '[]'::jsonb) AS rows
      FROM (
        SELECT
          jsonb_build_object(
            'driver_id', r.driver_id,
            'driver_name', r.driver_name,
            'employee_id', r.employee_id,
            'driver_code', r.driver_code,
            'restaurant_id', r.restaurant_id,
            'restaurant_name', r.restaurant_name,
            'zone_id', r.zone_id,
            'zone_name', r.zone_name,
            'actual', r.actual,
            'target', r.target,
            'efficiency', r.efficiency,
            'dpd_rider', r.dpd_rider,
            'worked_days', r.worked_days
          ) AS row_json,
          ROW_NUMBER() OVER (ORDER BY r.efficiency DESC, r.actual DESC) AS ord
        FROM ranked r
      ) x
      WHERE x.ord <= 10
    ),
    bottom10 AS (
      SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.ord), '[]'::jsonb) AS rows
      FROM (
        SELECT
          jsonb_build_object(
            'driver_id', r.driver_id,
            'driver_name', r.driver_name,
            'employee_id', r.employee_id,
            'driver_code', r.driver_code,
            'restaurant_id', r.restaurant_id,
            'restaurant_name', r.restaurant_name,
            'zone_id', r.zone_id,
            'zone_name', r.zone_name,
            'actual', r.actual,
            'target', r.target,
            'efficiency', r.efficiency,
            'dpd_rider', r.dpd_rider,
            'worked_days', r.worked_days
          ) AS row_json,
          ROW_NUMBER() OVER (ORDER BY r.efficiency ASC, r.actual ASC) AS ord
        FROM ranked r
      ) x
      WHERE x.ord <= 10
    ),
    rest_roll AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.restaurant_id,
            'name', g.restaurant_name,
            'restaurant_id', g.restaurant_id,
            'restaurant_name', g.restaurant_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.restaurant_id,
          s.restaurant_name,
          s.zone_id,
          s.zone_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        GROUP BY s.restaurant_id, s.restaurant_name, s.zone_id, s.zone_name
      ) g
    ),
    zone_roll AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.zone_id,
            'name', g.zone_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.zone_id,
          s.zone_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        GROUP BY s.zone_id, s.zone_name
      ) g
    ),
    zone_rest AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', g.restaurant_id,
            'name', g.restaurant_name,
            'zone_id', g.zone_id,
            'zone_name', g.zone_name,
            'restaurant_id', g.restaurant_id,
            'restaurant_name', g.restaurant_name,
            'actual', g.actual,
            'target', g.target,
            'efficiency', g.efficiency,
            'riders', g.riders
          )
          ORDER BY g.zone_name, g.efficiency DESC NULLS LAST
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT
          s.zone_id,
          s.zone_name,
          s.restaurant_id,
          s.restaurant_name,
          SUM(s.actual)::integer AS actual,
          SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) AS target,
          CASE
            WHEN SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) IS NULL
              OR SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0) <= 0
            THEN NULL
            ELSE SUM(s.actual) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
              / SUM(s.target) FILTER (WHERE s.target IS NOT NULL AND s.target > 0)
          END AS efficiency,
          COUNT(*)::integer AS riders
        FROM scored s
        WHERE s.restaurant_id IS NOT NULL
        GROUP BY s.zone_id, s.zone_name, s.restaurant_id, s.restaurant_name
      ) g
    )
    SELECT jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'riders', (SELECT rows FROM rider_json),
      'restaurants', (SELECT rows FROM rest_roll),
      'zones', (SELECT rows FROM zone_roll),
      'zone_restaurants', (SELECT rows FROM zone_rest),
      'top10', (SELECT rows FROM top10),
      'bottom10', (SELECT rows FROM bottom10)
    )
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_performance_ops_snapshot(
  p_from date,
  p_to date,
  p_project_keys text[] DEFAULT NULL,
  p_zone_ids uuid[] DEFAULT NULL,
  p_vehicle_keys text[] DEFAULT NULL,
  p_nationalities text[] DEFAULT NULL,
  p_source_types text[] DEFAULT NULL,
  p_source_companies text[] DEFAULT NULL,
  p_restaurant_ids uuid[] DEFAULT NULL,
  p_outsource_only boolean DEFAULT false,
  p_granularity text DEFAULT 'daily',
  p_trend_from date DEFAULT NULL,
  p_trend_to date DEFAULT NULL,
  p_order_status text DEFAULT 'verified'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from date;
  v_to date;
  v_prev_from date;
  v_prev_to date;
  v_n integer;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_target numeric;
  v_mode text;
  v_gran text;
  v_trend_from date;
  v_trend_to date;
  v_scan_from date;
  v_scan_to date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_from := p_from;
  v_to := p_to;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
  IF (v_to - v_from) + 1 > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_n := (v_to - v_from) + 1;
  v_prev_to := v_from - 1;
  v_prev_from := v_from - v_n;
  v_trend_from := COALESCE(p_trend_from, v_from);
  v_trend_to := COALESCE(p_trend_to, v_to);
  IF v_trend_to < v_trend_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
  IF (v_trend_to - v_trend_from) + 1 > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;
  IF p_order_status IS NULL OR p_order_status NOT IN ('verified', 'pending', 'in_transit', 'all') THEN
    RAISE EXCEPTION 'invalid_order_status';
  END IF;
  v_scan_from := LEAST(v_prev_from, v_trend_from);
  v_scan_to := GREATEST(v_to, v_trend_to);
  v_start := (v_scan_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_end := ((v_scan_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_prev_start := v_start;

  v_gran := CASE
    WHEN p_granularity IN ('daily', 'weekly', 'monthly') THEN p_granularity
    ELSE 'daily'
  END;

  v_mode := CASE
    WHEN p_project_keys IS NULL OR cardinality(p_project_keys) = 0 THEN 'all'
    WHEN 'americana' = ANY (p_project_keys) AND 'keeta' = ANY (p_project_keys) THEN 'all'
    WHEN 'americana' = ANY (p_project_keys) AND NOT ('keeta' = ANY (p_project_keys)) THEN 'americana'
    WHEN 'keeta' = ANY (p_project_keys) AND NOT ('americana' = ANY (p_project_keys)) THEN 'keeta'
    ELSE 'all'
  END;

  SELECT t.target INTO v_target
  FROM public.performance_target_dpd t
  WHERE t.zone_id IS NULL
    AND t.team_key IS NULL
    AND t.month <= date_trunc('month', v_to)::date
  ORDER BY t.month DESC
  LIMIT 1;
  v_target := COALESCE(v_target, 25);

  RETURN (
    WITH store_map AS (
      SELECT DISTINCT ON (dr.driver_id)
        dr.driver_id,
        dr.restaurant_id
      FROM public.driver_restaurants dr
      ORDER BY dr.driver_id, dr.restaurant_id ASC
    ),
    roster AS (
      SELECT
        d.id,
        p.full_name AS name,
        d.employee_id,
        d.driver_code,
        d.zone_id,
        z.name AS zone_name,
        d.project_key,
        d.nationality,
        d.rider_category,
        d.source_company,
        d.archived_at,
        sm.restaurant_id AS store_id,
        CASE
          WHEN d.project_key = 'keeta' THEN NULL
          ELSE r.name
        END AS store_name,
        CASE
          WHEN d.vehicle_id IS NULL THEN NULL
          ELSE v.vehicle_type_key
        END AS vehicle_key
      FROM public.drivers d
      LEFT JOIN public.profiles p ON p.id = d.id
      LEFT JOIN public.zones z ON z.id = d.zone_id
      LEFT JOIN store_map sm ON sm.driver_id = d.id
      LEFT JOIN public.restaurants r ON r.id = sm.restaurant_id
      LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
      WHERE (d.archived_at IS NULL OR d.archived_at >= (v_from::timestamp AT TIME ZONE 'Asia/Kuwait'))
        AND (
          NOT COALESCE(p_outsource_only, false)
          OR d.rider_category = 'outsourced'
        )
        AND (
          p_project_keys IS NULL OR cardinality(p_project_keys) = 0
          OR d.project_key = ANY (p_project_keys)
        )
        AND (
          p_zone_ids IS NULL OR cardinality(p_zone_ids) = 0
          OR d.zone_id = ANY (p_zone_ids)
        )
        AND (
          p_vehicle_keys IS NULL OR cardinality(p_vehicle_keys) = 0
          OR (d.vehicle_id IS NOT NULL AND v.vehicle_type_key = ANY (p_vehicle_keys))
        )
        AND (
          p_nationalities IS NULL OR cardinality(p_nationalities) = 0
          OR d.nationality = ANY (p_nationalities)
        )
        AND (
          COALESCE(p_outsource_only, false)
          OR p_source_types IS NULL OR cardinality(p_source_types) = 0
          OR d.rider_category::text = ANY (p_source_types)
        )
        AND (
          p_source_companies IS NULL OR cardinality(p_source_companies) = 0
          OR d.source_company = ANY (p_source_companies)
        )
        AND (
          p_restaurant_ids IS NULL OR cardinality(p_restaurant_ids) = 0
          OR sm.restaurant_id = ANY (p_restaurant_ids)
        )
    ),
    daily AS (
      SELECT
        del.driver_id,
        (timezone('Asia/Kuwait', COALESCE(del.delivered_at, del.pickup_at, del.created_at)))::date AS day,
        COUNT(*)::integer AS orders
      FROM public.deliveries del
      WHERE del.status::text = ANY (
          CASE p_order_status
            WHEN 'all' THEN ARRAY['pending', 'in_transit', 'verified']::text[]
            ELSE ARRAY[p_order_status]
          END
        )
        AND COALESCE(del.delivered_at, del.pickup_at, del.created_at) IS NOT NULL
        AND COALESCE(del.delivered_at, del.pickup_at, del.created_at) >= v_prev_start
        AND COALESCE(del.delivered_at, del.pickup_at, del.created_at) < v_end
        AND del.driver_id IN (SELECT id FROM roster)
      GROUP BY 1, 2
    ),
    rider_cur AS (
      SELECT
        r.*,
        COALESCE(SUM(d.orders) FILTER (WHERE d.day BETWEEN v_from AND v_to), 0)::integer AS orders,
        COUNT(*) FILTER (WHERE d.day BETWEEN v_from AND v_to AND d.orders > 0)::integer AS working_days
      FROM roster r
      LEFT JOIN daily d ON d.driver_id = r.id
      GROUP BY
        r.id, r.name, r.employee_id, r.driver_code, r.zone_id, r.zone_name,
        r.project_key, r.nationality, r.rider_category, r.source_company,
        r.archived_at, r.store_id, r.store_name, r.vehicle_key
    ),
    rider_prev AS (
      SELECT
        r.id,
        COALESCE(SUM(d.orders) FILTER (WHERE d.day BETWEEN v_prev_from AND v_prev_to), 0)::integer AS orders,
        COUNT(*) FILTER (WHERE d.day BETWEEN v_prev_from AND v_prev_to AND d.orders > 0)::integer AS working_days
      FROM roster r
      LEFT JOIN daily d ON d.driver_id = r.id
      GROUP BY r.id
    ),
    store_stats AS (
      SELECT
        c.store_id,
        MIN(c.store_name) AS store_name,
        (ARRAY_AGG(c.zone_id))[1] AS zone_id,
        MIN(c.zone_name) AS zone_name,
        SUM(c.orders)::integer AS orders,
        SUM(c.working_days)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE c.working_days > 0)::integer AS active_riders,
        CASE
          WHEN SUM(c.working_days) > 0 THEN SUM(c.orders)::numeric / SUM(c.working_days)
          ELSE NULL
        END AS store_dpd
      FROM rider_cur c
      WHERE c.store_id IS NOT NULL AND c.project_key IS DISTINCT FROM 'keeta'
      GROUP BY c.store_id
    ),
    zv_stats AS (
      SELECT
        c.zone_id,
        c.vehicle_key,
        SUM(c.orders)::integer AS orders,
        SUM(c.working_days)::integer AS working_days,
        CASE
          WHEN SUM(c.working_days) > 0 THEN SUM(c.orders)::numeric / SUM(c.working_days)
          ELSE NULL
        END AS zv_dpd
      FROM rider_cur c
      WHERE c.vehicle_key IS NOT NULL AND c.zone_id IS NOT NULL
      GROUP BY c.zone_id, c.vehicle_key
    ),
    scored AS (
      SELECT
        c.*,
        CASE WHEN c.working_days > 0 THEN c.orders::numeric / c.working_days ELSE NULL END AS dpd,
        ss.store_dpd,
        zv.zv_dpd,
        CASE v_mode
          WHEN 'americana' THEN ss.store_dpd
          WHEN 'keeta' THEN zv.zv_dpd
          ELSE CASE
            WHEN ss.store_dpd IS NOT NULL AND zv.zv_dpd IS NOT NULL
              THEN (ss.store_dpd + zv.zv_dpd) / 2
            ELSE COALESCE(ss.store_dpd, zv.zv_dpd)
          END
        END AS benchmark,
        CASE WHEN ct.applies THEN ct.target::numeric ELSE v_target END AS target_dpd
      FROM rider_cur c
      LEFT JOIN store_stats ss ON ss.store_id = c.store_id
      LEFT JOIN zv_stats zv
        ON zv.zone_id = c.zone_id AND zv.vehicle_key = c.vehicle_key
      LEFT JOIN LATERAL (
        SELECT sc.dpd_target AS target, true AS applies
        FROM public.source_companies sc
        WHERE c.rider_category = 'outsourced'
          AND c.source_company IS NOT NULL
          AND sc.key = c.source_company
          AND sc.effective_from IS NOT NULL
          AND v_to >= sc.effective_from
      ) ct ON true
    ),
    scored2 AS (
      SELECT
        s.*,
        CASE
          WHEN s.dpd IS NOT NULL AND s.benchmark IS NOT NULL AND s.benchmark > 0
            THEN (s.dpd / s.benchmark) * 100
          ELSE NULL
        END AS dpd_eff,
        CASE
          WHEN s.dpd IS NOT NULL AND s.target_dpd > 0
            THEN (s.dpd / s.target_dpd) * 100
          ELSE NULL
        END AS tgt_eff
      FROM scored s
    ),
    prev_tot AS (
      SELECT
        COALESCE(SUM(p.orders), 0)::integer AS orders,
        COALESCE(SUM(p.working_days), 0)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE p.working_days > 0)::integer AS active
      FROM rider_prev p
    ),
    cur_tot AS (
      SELECT
        COALESCE(SUM(s.orders), 0)::integer AS orders,
        COALESCE(SUM(s.working_days), 0)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active,
        CASE
          WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days)
          ELSE NULL
        END AS overall_dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS avg_dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS avg_tgt_eff
      FROM scored2 s
    ),
    prev_scored AS (
      SELECT
        CASE
          WHEN SUM(p.working_days) > 0 THEN SUM(p.orders)::numeric / SUM(p.working_days)
          ELSE NULL
        END AS overall_dpd
      FROM rider_prev p
    ),
    prev_eff AS (
      SELECT
        AVG(x.dpd_eff) AS avg_dpd_eff,
        AVG(x.tgt_eff) AS avg_tgt_eff
      FROM (
        SELECT
          CASE
            WHEN p.working_days > 0 AND b.benchmark IS NOT NULL AND b.benchmark > 0
              THEN ((p.orders::numeric / p.working_days) / b.benchmark) * 100
            ELSE NULL
          END AS dpd_eff,
          CASE
            WHEN p.working_days > 0 AND v_target > 0
              THEN ((p.orders::numeric / p.working_days) / v_target) * 100
            ELSE NULL
          END AS tgt_eff
        FROM rider_prev p
        JOIN scored2 b ON b.id = p.id
      ) x
    ),
    store_vs AS (
      SELECT
        COUNT(*) FILTER (WHERE store_dpd >= v_target)::integer AS above,
        COUNT(*) FILTER (WHERE store_dpd IS NOT NULL AND store_dpd < v_target)::integer AS below
      FROM store_stats
    ),
    buckets AS (
      SELECT
        d.day,
        CASE v_gran
          WHEN 'weekly' THEN (
            date_trunc('month', d.day)::date
            + (LEAST(((d.day - date_trunc('month', d.day)::date) / 7), 3) * 7)
          )
          WHEN 'monthly' THEN date_trunc('month', d.day)::date
          ELSE d.day
        END AS bucket,
        SUM(d.orders)::integer AS orders,
        COUNT(*) FILTER (WHERE d.orders > 0)::integer AS working_days
      FROM daily d
      WHERE d.day BETWEEN v_trend_from AND v_trend_to
      GROUP BY 1, 2
    ),
    trend AS (
      SELECT
        bucket,
        SUM(orders)::integer AS orders,
        SUM(working_days)::integer AS working_days,
        CASE
          WHEN SUM(working_days) > 0 THEN SUM(orders)::numeric / SUM(working_days)
          ELSE NULL
        END AS dpd
      FROM buckets
      GROUP BY bucket
    ),
    dim_vehicle AS (
      SELECT
        s.vehicle_key AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      WHERE s.vehicle_key IS NOT NULL
      GROUP BY s.vehicle_key
    ),
    dim_zone AS (
      SELECT
        s.zone_id AS id,
        s.zone_name AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active_riders,
        COUNT(*) FILTER (WHERE s.vehicle_key = 'bike')::integer AS bikes,
        COUNT(*) FILTER (WHERE s.vehicle_key = 'car')::integer AS cars
      FROM scored2 s
      WHERE NULLIF(btrim(s.zone_name), '') IS NOT NULL
      GROUP BY s.zone_id, s.zone_name
    ),
    dim_partner AS (
      SELECT
        s.project_key AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      WHERE NULLIF(btrim(s.project_key), '') IS NOT NULL
      GROUP BY s.project_key
    ),
    dim_nat AS (
      SELECT
        s.nationality AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      WHERE NULLIF(btrim(s.nationality), '') IS NOT NULL
      GROUP BY s.nationality
    ),
    dim_company AS (
      SELECT
        COALESCE(NULLIF(btrim(s.source_company), ''), 'unassigned') AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active_riders
      FROM scored2 s
      GROUP BY 1
    ),
        options AS (
      SELECT jsonb_build_object(
        'zones', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) ORDER BY z.name)
          FROM public.zones z
        ), '[]'::jsonb),
        'restaurants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
          FROM public.restaurants r
          WHERE r.is_active = true
        ), '[]'::jsonb),
        'nationalities', COALESCE((
          SELECT jsonb_agg(x ORDER BY x)
          FROM (
            SELECT DISTINCT d.nationality AS x
            FROM public.drivers d
            WHERE d.archived_at IS NULL AND d.nationality IS NOT NULL
          ) q
        ), '[]'::jsonb)
      ) AS payload
    )
    SELECT jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'prev_from', v_prev_from,
      'prev_to', v_prev_to,
      'target_dpd', v_target,
      'partner_mode', v_mode,
      'kpis', jsonb_build_object(
        'orders', (SELECT orders FROM cur_tot),
        'orders_prev', (SELECT orders FROM prev_tot),
        'overall_dpd', (SELECT overall_dpd FROM cur_tot),
        'overall_dpd_prev', (SELECT overall_dpd FROM prev_scored),
        'avg_dpd_eff', (SELECT avg_dpd_eff FROM cur_tot),
        'avg_dpd_eff_prev', (SELECT avg_dpd_eff FROM prev_eff),
        'avg_tgt_eff', (SELECT avg_tgt_eff FROM cur_tot),
        'avg_tgt_eff_prev', (SELECT avg_tgt_eff FROM prev_eff),
        'riders', (SELECT riders FROM cur_tot),
        'riders_prev', (SELECT riders FROM prev_tot),
        'active', (SELECT active FROM cur_tot),
        'active_prev', (SELECT active FROM prev_tot),
        'working_days', (SELECT working_days FROM cur_tot),
        'stores_above', (SELECT above FROM store_vs),
        'stores_below', (SELECT below FROM store_vs)
      ),
      'trend', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bucket', t.bucket,
          'orders', t.orders,
          'working_days', t.working_days,
          'dpd', t.dpd,
          'dpd_eff', CASE
            WHEN t.dpd IS NOT NULL AND c.overall_dpd IS NOT NULL AND c.overall_dpd > 0
              THEN (t.dpd / NULLIF(c.overall_dpd, 0)) * COALESCE(c.avg_dpd_eff, 0)
            ELSE NULL
          END,
          'tgt_eff', CASE
            WHEN t.dpd IS NOT NULL AND v_target > 0 THEN (t.dpd / v_target) * 100
            ELSE NULL
          END
        ) ORDER BY t.bucket)
        FROM trend t
        CROSS JOIN cur_tot c
      ), '[]'::jsonb),
      'by_vehicle', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_vehicle d), '[]'::jsonb),
      'by_zone', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_zone d), '[]'::jsonb),
      'by_partner', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_partner d), '[]'::jsonb),
      'by_nationality', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_nat d), '[]'::jsonb),
      'by_company', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_company d), '[]'::jsonb),
      'stores', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.store_name) FROM store_stats s), '[]'::jsonb),
      'riders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'driver_id', s.id,
          'name', s.name,
          'employee_id', s.employee_id,
          'driver_code', s.driver_code,
          'zone_id', s.zone_id,
          'zone', s.zone_name,
          'vehicle_key', s.vehicle_key,
          'nationality', s.nationality,
          'project_key', s.project_key,
          'store_id', s.store_id,
          'store', s.store_name,
          'source_type', s.rider_category,
          'source_company', s.source_company,
          'orders', s.orders,
          'working_days', s.working_days,
          'dpd', s.dpd,
          'target_dpd', s.target_dpd,
          'store_dpd', s.store_dpd,
          'veh_zone_dpd', s.zv_dpd,
          'dpd_eff', s.dpd_eff,
          'tgt_eff', s.tgt_eff,
          'status', CASE WHEN s.working_days > 0 THEN 'Active' ELSE 'Inactive' END
        ) ORDER BY s.orders DESC, s.name)
        FROM scored2 s
      ), '[]'::jsonb),
      'options', (SELECT payload FROM options)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_performance_ops_snapshot(date, date, text[], uuid[], text[], text[], text[], text[], uuid[], boolean, text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_performance_ops_snapshot(date, date, text[], uuid[], text[], text[], text[], text[], uuid[], boolean, text, date, date, text) TO authenticated;
