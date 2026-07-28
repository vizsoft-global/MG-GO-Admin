-- Multi-target scopes for incentive_rules and delivery_rules (junction tables).

CREATE TABLE IF NOT EXISTS public.incentive_rule_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incentive_rule_id uuid NOT NULL REFERENCES public.incentive_rules(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_rule_scopes_one_target_chk CHECK (
    (zone_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (partner_id IS NOT NULL AND zone_id IS NULL AND restaurant_id IS NULL)
    OR (restaurant_id IS NOT NULL AND zone_id IS NULL AND partner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS incentive_rule_scopes_unique_idx
  ON public.incentive_rule_scopes (
    incentive_rule_id,
    COALESCE(zone_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS incentive_rule_scopes_rule_id_idx
  ON public.incentive_rule_scopes (incentive_rule_id);
CREATE INDEX IF NOT EXISTS incentive_rule_scopes_zone_id_idx
  ON public.incentive_rule_scopes (zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS incentive_rule_scopes_partner_id_idx
  ON public.incentive_rule_scopes (partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS incentive_rule_scopes_restaurant_id_idx
  ON public.incentive_rule_scopes (restaurant_id) WHERE restaurant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.delivery_rule_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_rule_id uuid NOT NULL REFERENCES public.delivery_rules(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_rule_scopes_one_target_chk CHECK (
    (zone_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (partner_id IS NOT NULL AND zone_id IS NULL AND restaurant_id IS NULL)
    OR (restaurant_id IS NOT NULL AND zone_id IS NULL AND partner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_rule_scopes_unique_idx
  ON public.delivery_rule_scopes (
    delivery_rule_id,
    COALESCE(zone_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS delivery_rule_scopes_rule_id_idx
  ON public.delivery_rule_scopes (delivery_rule_id);
CREATE INDEX IF NOT EXISTS delivery_rule_scopes_zone_id_idx
  ON public.delivery_rule_scopes (zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_rule_scopes_partner_id_idx
  ON public.delivery_rule_scopes (partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_rule_scopes_restaurant_id_idx
  ON public.delivery_rule_scopes (restaurant_id) WHERE restaurant_id IS NOT NULL;

-- Backfill from legacy single-FK columns
INSERT INTO public.incentive_rule_scopes (incentive_rule_id, zone_id, partner_id, restaurant_id)
SELECT ir.id, ir.zone_id, ir.partner_id, ir.restaurant_id
FROM public.incentive_rules ir
WHERE ir.zone_id IS NOT NULL OR ir.partner_id IS NOT NULL OR ir.restaurant_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.delivery_rule_scopes (delivery_rule_id, zone_id, partner_id, restaurant_id)
SELECT dr.id, dr.zone_id, dr.partner_id, dr.restaurant_id
FROM public.delivery_rules dr
WHERE dr.zone_id IS NOT NULL OR dr.partner_id IS NOT NULL OR dr.restaurant_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.incentive_rules DROP CONSTRAINT IF EXISTS incentive_rules_scope_check;
ALTER TABLE public.delivery_rules DROP CONSTRAINT IF EXISTS delivery_rules_scope_check;

-- RLS: inherit from parent rule access (service role + admin policies on parent tables)
ALTER TABLE public.incentive_rule_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_rule_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incentive_rule_scopes_admin ON public.incentive_rule_scopes;
CREATE POLICY incentive_rule_scopes_admin ON public.incentive_rule_scopes
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS delivery_rule_scopes_admin ON public.delivery_rule_scopes;
CREATE POLICY delivery_rule_scopes_admin ON public.delivery_rule_scopes
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- Drop old count_eligible_deliveries signature
DROP FUNCTION IF EXISTS public.count_eligible_deliveries(
  uuid, date, public.rule_scope_type, uuid, uuid, uuid, public.incentive_period
);

CREATE OR REPLACE FUNCTION public.count_eligible_deliveries(
  p_driver_id uuid,
  p_earn_date date,
  p_incentive_rule_id uuid
)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN v_period_start AND v_period_end
    AND public.delivery_matches_rules(d.id, p_earn_date)
    AND EXISTS (
      SELECT 1
      FROM public.incentive_rule_scopes s
      WHERE s.incentive_rule_id = p_incentive_rule_id
        AND (
          (v_rule.scope_type = 'zone' AND s.zone_id = d.zone_id)
          OR (v_rule.scope_type = 'partner' AND s.partner_id = d.partner_id)
          OR (v_rule.scope_type = 'restaurant' AND s.restaurant_id = d.restaurant_id)
        )
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_matches_rules(
  p_delivery_id uuid,
  p_on_date date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery record;
  v_check_date date;
  v_rule_count int;
  v_match_count int;
BEGIN
  SELECT d.id, d.driver_id, d.zone_id, d.partner_id, d.restaurant_id, d.status,
         (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS deliver_date
  INTO v_delivery
  FROM public.deliveries d
  WHERE d.id = p_delivery_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_delivery.status IS DISTINCT FROM 'verified' THEN
    RETURN false;
  END IF;

  v_check_date := COALESCE(p_on_date, v_delivery.deliver_date);

  SELECT count(*)::int INTO v_rule_count
  FROM public.delivery_rules dr
  WHERE dr.status = 'active'
    AND v_check_date BETWEEN dr.start_date AND dr.end_date;

  IF v_rule_count = 0 THEN
    RETURN true;
  END IF;

  SELECT count(*)::int INTO v_match_count
  FROM public.delivery_rules dr
  WHERE dr.status = 'active'
    AND v_check_date BETWEEN dr.start_date AND dr.end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s
      WHERE s.delivery_rule_id = dr.id
        AND (
          (dr.scope_type = 'zone' AND s.zone_id = v_delivery.zone_id)
          OR (dr.scope_type = 'partner' AND s.partner_id = v_delivery.partner_id)
          OR (dr.scope_type = 'restaurant' AND s.restaurant_id = v_delivery.restaurant_id)
        )
    );

  RETURN v_match_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_driver_earnings(
  p_driver_id uuid,
  p_earn_date date
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

  SELECT count(*)::int INTO v_deliveries
  FROM public.deliveries d
  WHERE d.driver_id = p_driver_id
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
    AND public.delivery_matches_rules(d.id, p_earn_date);

  FOR v_rule IN
    SELECT ir.*
    FROM public.incentive_rules ir
    WHERE ir.status = 'active'
      AND p_earn_date BETWEEN ir.start_date AND ir.end_date
    ORDER BY ir.priority DESC, ir.created_at ASC
  LOOP
    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.id
    );

    v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);

    IF v_rule.overrides_others AND v_rule_amount > 0 AND v_rule.priority > v_override_priority THEN
      v_override_amount := v_rule_amount;
      v_override_priority := v_rule.priority;
    END IF;

    v_incentive := v_incentive + v_rule_amount;
  END LOOP;

  IF v_override_amount >= 0 THEN
    v_incentive := v_override_amount;
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
    now()
  )
  ON CONFLICT (driver_id, earn_date) DO UPDATE SET
    deliveries = EXCLUDED.deliveries,
    base_kwd = EXCLUDED.base_kwd,
    incentive_kwd = EXCLUDED.incentive_kwd,
    net_kwd = EXCLUDED.net_kwd,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_driver_earnings(p_earn_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_rows jsonb := '[]'::jsonb;
  v_deliveries int;
  v_incentive numeric(10, 3);
  v_rule record;
  v_eligible_count int;
  v_breakdown jsonb;
  v_amount numeric(10, 3);
  v_tier_lines jsonb;
  v_override_amount numeric(10, 3);
  v_override_priority int;
  v_override_rule_id uuid;
BEGIN
  FOR v_driver IN
    SELECT DISTINCT d.driver_id AS id
    FROM public.deliveries d
    WHERE d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
  LOOP
    v_incentive := 0;
    v_breakdown := '[]'::jsonb;
    v_override_amount := -1;
    v_override_priority := -1;
    v_override_rule_id := NULL;

    SELECT count(*)::int INTO v_deliveries
    FROM public.deliveries d
    WHERE d.driver_id = v_driver.id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
      AND public.delivery_matches_rules(d.id, p_earn_date);

    FOR v_rule IN
      SELECT ir.*
      FROM public.incentive_rules ir
      WHERE ir.status = 'active'
        AND p_earn_date BETWEEN ir.start_date AND ir.end_date
      ORDER BY ir.priority DESC, ir.created_at ASC
    LOOP
      v_eligible_count := public.count_eligible_deliveries(
        v_driver.id,
        p_earn_date,
        v_rule.id
      );

      v_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);
      IF v_amount > 0 THEN
        v_incentive := v_incentive + v_amount;

        IF v_rule.overrides_others AND v_rule.priority > v_override_priority THEN
          v_override_amount := v_amount;
          v_override_priority := v_rule.priority;
          v_override_rule_id := v_rule.id;
        END IF;

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
          'reward_kwd', v_amount,
          'amount_kwd', v_amount,
          'tiers', v_tier_lines
        ));
      END IF;
    END LOOP;

    IF v_override_amount >= 0 THEN
      v_incentive := v_override_amount;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'override_rule_id', v_override_rule_id,
        'note', 'override_applied'
      ));
    END IF;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'driver_id', v_driver.id,
      'deliveries', v_deliveries,
      'incentive_kwd', v_incentive,
      'rules', v_breakdown
    ));
  END LOOP;

  RETURN jsonb_build_object('earn_date', p_earn_date, 'drivers', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_eligible_deliveries(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_eligible_deliveries(uuid, date, uuid) TO service_role;
