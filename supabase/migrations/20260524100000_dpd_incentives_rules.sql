-- DPD incentives: restaurants, delivery rules, incentive rules, earnings recalculation

DO $$ BEGIN
  CREATE TYPE public.rule_scope_type AS ENUM ('zone', 'partner', 'restaurant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.rule_status AS ENUM ('draft', 'active', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.incentive_period AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Restaurants directory
CREATE TABLE IF NOT EXISTS public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_merchant_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurants_partner_name_unique UNIQUE (partner_id, name)
);

CREATE INDEX IF NOT EXISTS restaurants_partner_id_idx ON public.restaurants (partner_id);

-- Deliveries: optional restaurant
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES public.restaurants(id);

CREATE INDEX IF NOT EXISTS deliveries_driver_delivered_at_idx
  ON public.deliveries (driver_id, delivered_at);

-- Delivery rules (eligibility for incentive counting)
CREATE TABLE IF NOT EXISTS public.delivery_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.rule_status NOT NULL DEFAULT 'draft',
  scope_type public.rule_scope_type NOT NULL,
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  priority int NOT NULL DEFAULT 10,
  require_verified boolean NOT NULL DEFAULT true,
  must_match_driver_zone boolean NOT NULL DEFAULT false,
  must_match_partner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_rules_scope_check CHECK (
    (scope_type = 'zone' AND zone_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (scope_type = 'partner' AND partner_id IS NOT NULL AND zone_id IS NULL AND restaurant_id IS NULL)
    OR (scope_type = 'restaurant' AND restaurant_id IS NOT NULL AND zone_id IS NULL AND partner_id IS NULL)
  ),
  CONSTRAINT delivery_rules_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS delivery_rules_status_dates_idx
  ON public.delivery_rules (status, start_date, end_date);

-- Incentive rules (replaces offers for new admin work)
CREATE TABLE IF NOT EXISTS public.incentive_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.rule_status NOT NULL DEFAULT 'draft',
  scope_type public.rule_scope_type NOT NULL,
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  period public.incentive_period NOT NULL,
  target_deliveries int NOT NULL DEFAULT 1,
  reward_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  start_date date NOT NULL,
  end_date date NOT NULL,
  priority int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_rules_scope_check CHECK (
    (scope_type = 'zone' AND zone_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (scope_type = 'partner' AND partner_id IS NOT NULL AND zone_id IS NULL AND restaurant_id IS NULL)
    OR (scope_type = 'restaurant' AND restaurant_id IS NOT NULL AND zone_id IS NULL AND partner_id IS NULL)
  ),
  CONSTRAINT incentive_rules_dates_check CHECK (end_date >= start_date),
  CONSTRAINT incentive_rules_target_positive CHECK (target_deliveries > 0),
  CONSTRAINT incentive_rules_reward_non_negative CHECK (reward_kwd >= 0)
);

CREATE INDEX IF NOT EXISTS incentive_rules_status_dates_idx
  ON public.incentive_rules (status, start_date, end_date);

-- Migrate legacy offers → incentive_rules
INSERT INTO public.incentive_rules (
  name,
  status,
  scope_type,
  zone_id,
  period,
  target_deliveries,
  reward_kwd,
  start_date,
  end_date,
  priority,
  created_at,
  updated_at
)
SELECT
  o.name,
  CASE o.status::text
    WHEN 'draft' THEN 'draft'::public.rule_status
    WHEN 'active' THEN 'active'::public.rule_status
    ELSE 'ended'::public.rule_status
  END,
  'zone'::public.rule_scope_type,
  o.zone_id,
  o.offer_type::text::public.incentive_period,
  o.target_deliveries,
  o.reward_kwd,
  o.start_date,
  o.end_date,
  10,
  o.created_at,
  o.updated_at
FROM public.offers o
WHERE o.zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.incentive_rules ir
    WHERE ir.name = o.name AND ir.zone_id = o.zone_id AND ir.start_date = o.start_date
  );

-- Kuwait calendar helpers (Asia/Kuwait)
CREATE OR REPLACE FUNCTION public.kuwait_week_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_date - ((EXTRACT(ISODOW FROM p_date)::int + 6) % 7);
$$;

CREATE OR REPLACE FUNCTION public.kuwait_month_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', p_date::timestamp)::date;
$$;

-- True when delivery matches an active delivery_rule (or no rules configured)
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
    AND (
      (dr.scope_type = 'zone' AND dr.zone_id = v_delivery.zone_id)
      OR (dr.scope_type = 'partner' AND dr.partner_id = v_delivery.partner_id)
      OR (dr.scope_type = 'restaurant' AND dr.restaurant_id = v_delivery.restaurant_id)
    );

  RETURN v_match_count > 0;
END;
$$;

-- Count eligible verified deliveries for a driver in scope + period up to earn_date
CREATE OR REPLACE FUNCTION public.count_eligible_deliveries(
  p_driver_id uuid,
  p_earn_date date,
  p_scope_type public.rule_scope_type,
  p_zone_id uuid,
  p_partner_id uuid,
  p_restaurant_id uuid,
  p_period public.incentive_period
)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start date;
  v_period_end date;
  v_count int;
BEGIN
  v_period_end := p_earn_date;

  CASE p_period
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
    AND public.delivery_matches_rules(d.id, (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date)
    AND (
      (p_scope_type = 'zone' AND d.zone_id = p_zone_id)
      OR (p_scope_type = 'partner' AND d.partner_id = p_partner_id)
      OR (p_scope_type = 'restaurant' AND d.restaurant_id = p_restaurant_id)
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Recalculate and upsert driver_earnings_daily for one driver + date
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
  LOOP
    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.scope_type,
      v_rule.zone_id,
      v_rule.partner_id,
      v_rule.restaurant_id,
      v_rule.period
    );

    IF v_eligible_count >= v_rule.target_deliveries THEN
      v_incentive := v_incentive + v_rule.reward_kwd;
    END IF;
  END LOOP;

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

-- Preview incentives for a date (no writes)
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
BEGIN
  FOR v_driver IN
    SELECT DISTINCT d.driver_id AS id
    FROM public.deliveries d
    WHERE d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
  LOOP
    v_incentive := 0;
    v_breakdown := '[]'::jsonb;

    SELECT count(*)::int INTO v_deliveries
    FROM public.deliveries d
    WHERE d.driver_id = v_driver.id
      AND d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
      AND public.delivery_matches_rules(d.id, p_earn_date);

    FOR v_rule IN
      SELECT ir.id, ir.name, ir.period, ir.target_deliveries, ir.reward_kwd,
             ir.scope_type, ir.zone_id, ir.partner_id, ir.restaurant_id
      FROM public.incentive_rules ir
      WHERE ir.status = 'active'
        AND p_earn_date BETWEEN ir.start_date AND ir.end_date
    LOOP
      v_eligible_count := public.count_eligible_deliveries(
        v_driver.id,
        p_earn_date,
        v_rule.scope_type,
        v_rule.zone_id,
        v_rule.partner_id,
        v_rule.restaurant_id,
        v_rule.period
      );

      IF v_eligible_count >= v_rule.target_deliveries THEN
        v_incentive := v_incentive + v_rule.reward_kwd;
        v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_name', v_rule.name,
          'period', v_rule.period,
          'eligible_count', v_eligible_count,
          'target', v_rule.target_deliveries,
          'reward_kwd', v_rule.reward_kwd
        ));
      END IF;
    END LOOP;

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

-- Recalculate all drivers with verified deliveries on a date
CREATE OR REPLACE FUNCTION public.recalculate_earnings_for_date(p_earn_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_count int := 0;
BEGIN
  FOR v_driver IN
    SELECT DISTINCT d.driver_id
    FROM public.deliveries d
    WHERE d.status = 'verified'
      AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date
  LOOP
    PERFORM public.recalculate_driver_earnings(v_driver.driver_id, p_earn_date);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Trigger: recalc when delivery verified
CREATE OR REPLACE FUNCTION public.trg_deliveries_recalc_earnings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'verified' AND (OLD.status IS DISTINCT FROM 'verified') THEN
    PERFORM public.recalculate_driver_earnings(
      NEW.driver_id,
      (NEW.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deliveries_recalc_earnings ON public.deliveries;
CREATE TRIGGER deliveries_recalc_earnings
  AFTER UPDATE OF status ON public.deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deliveries_recalc_earnings();

REVOKE ALL ON FUNCTION public.delivery_matches_rules(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_eligible_deliveries(uuid, date, public.rule_scope_type, uuid, uuid, uuid, public.incentive_period) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_driver_earnings(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_driver_earnings(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_earnings_for_date(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.delivery_matches_rules(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_driver_earnings(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_driver_earnings(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_earnings_for_date(date) TO authenticated;

-- RLS
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_rules ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['restaurants', 'delivery_rules', 'incentive_rules']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_all_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY staff_all_%I ON public.%I FOR ALL TO authenticated USING (public.is_admin_panel_user()) WITH CHECK (public.is_admin_panel_user())',
      t, t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.restaurants IS 'Merchant/restaurant directory for partner-scoped incentive and delivery rules';
COMMENT ON TABLE public.delivery_rules IS 'Defines which verified deliveries count toward incentives';
COMMENT ON TABLE public.incentive_rules IS 'Target deliveries + reward KWD by zone, partner, or restaurant';
