-- Earnings drilldown, range recalc, wallet ledger, admin activity logs.

DO $$ BEGIN
  CREATE TYPE public.wallet_entry_type AS ENUM (
    'earning_credit',
    'manual_adjustment',
    'payout_debit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_entry_status AS ENUM (
    'approved',
    'pending',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.admin_activity_action AS ENUM (
    'create',
    'update',
    'delete',
    'view',
    'read',
    'auth',
    'export',
    'recalculate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Wallet ledger (approved earnings for drivers / future payouts)
CREATE TABLE IF NOT EXISTS public.driver_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  earn_date date NOT NULL,
  entry_type public.wallet_entry_type NOT NULL DEFAULT 'earning_credit',
  amount_kwd numeric(10, 3) NOT NULL DEFAULT 0,
  status public.wallet_entry_status NOT NULL DEFAULT 'approved',
  source_ref text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_wallet_entries_amount_non_negative_chk CHECK (amount_kwd >= 0),
  CONSTRAINT driver_wallet_entries_source_ref_unique UNIQUE (source_ref)
);

CREATE INDEX IF NOT EXISTS driver_wallet_entries_driver_date_idx
  ON public.driver_wallet_entries (driver_id, earn_date DESC);
CREATE INDEX IF NOT EXISTS driver_wallet_entries_status_idx
  ON public.driver_wallet_entries (status);

COMMENT ON TABLE public.driver_wallet_entries IS
  'Approved earnings ledger; earning_credit rows sync from driver_earnings_daily.net_kwd.';

-- Admin activity audit log
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_role_slug text,
  action public.admin_activity_action NOT NULL,
  entity_type text,
  entity_id text,
  page_path text,
  route_name text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_activity_logs_created_at_idx
  ON public.admin_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_logs_admin_user_idx
  ON public.admin_activity_logs (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_logs_action_idx
  ON public.admin_activity_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_logs_entity_idx
  ON public.admin_activity_logs (entity_type, entity_id);

ALTER TABLE public.driver_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_wallet_entries_staff ON public.driver_wallet_entries;
CREATE POLICY driver_wallet_entries_staff ON public.driver_wallet_entries
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS driver_wallet_entries_driver_read ON public.driver_wallet_entries;
CREATE POLICY driver_wallet_entries_driver_read ON public.driver_wallet_entries
  FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    AND status = 'approved'
  );

DROP POLICY IF EXISTS admin_activity_logs_staff_read ON public.admin_activity_logs;
CREATE POLICY admin_activity_logs_staff_read ON public.admin_activity_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS admin_activity_logs_staff_insert ON public.admin_activity_logs;
CREATE POLICY admin_activity_logs_staff_insert ON public.admin_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_panel_user());

-- Sync wallet credit from daily earnings row (idempotent via source_ref)
CREATE OR REPLACE FUNCTION public.sync_driver_wallet_earning_credit(
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
  v_row public.driver_earnings_daily%ROWTYPE;
  v_source_ref text;
BEGIN
  SELECT * INTO v_row
  FROM public.driver_earnings_daily
  WHERE driver_id = p_driver_id AND earn_date = p_earn_date;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_source_ref := 'earning:' || p_driver_id::text || ':' || p_earn_date::text;

  INSERT INTO public.driver_wallet_entries (
    driver_id,
    earn_date,
    entry_type,
    amount_kwd,
    status,
    source_ref,
    approved_at,
    approved_by,
    meta,
    updated_at
  )
  VALUES (
    p_driver_id,
    p_earn_date,
    'earning_credit',
    GREATEST(v_row.net_kwd, 0),
    'approved',
    v_source_ref,
    now(),
    p_approved_by,
    jsonb_build_object(
      'deliveries', v_row.deliveries,
      'base_kwd', v_row.base_kwd,
      'incentive_kwd', v_row.incentive_kwd,
      'loan_deduction_kwd', v_row.loan_deduction_kwd,
      'penalty_kwd', v_row.penalty_kwd,
      'reimbursement_kwd', v_row.reimbursement_kwd,
      'net_kwd', v_row.net_kwd
    ),
    now()
  )
  ON CONFLICT (source_ref) DO UPDATE SET
    amount_kwd = EXCLUDED.amount_kwd,
    status = 'approved',
    approved_at = EXCLUDED.approved_at,
    approved_by = COALESCE(EXCLUDED.approved_by, public.driver_wallet_entries.approved_by),
    meta = EXCLUDED.meta,
    updated_at = now();
END;
$$;

-- Extend recalculate to sync wallet
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

  PERFORM public.sync_driver_wallet_earning_credit(p_driver_id, p_earn_date, p_approved_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_earnings_for_range(
  p_start_date date,
  p_end_date date,
  p_driver_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date;
  v_driver record;
  v_count int := 0;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  v_day := p_start_date;
  WHILE v_day <= p_end_date LOOP
    FOR v_driver IN
      SELECT DISTINCT d.driver_id
      FROM public.deliveries d
      WHERE d.status = 'verified'
        AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_day
        AND (p_driver_id IS NULL OR d.driver_id = p_driver_id)
    LOOP
      PERFORM public.recalculate_driver_earnings(v_driver.driver_id, v_day);
      v_count := v_count + 1;
    END LOOP;
    v_day := v_day + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_driver_earnings_detail(
  p_driver_id uuid,
  p_earn_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daily jsonb;
  v_deliveries jsonb := '[]'::jsonb;
  v_rules jsonb := '[]'::jsonb;
  v_rule record;
  v_eligible_count int;
  v_amount numeric(10, 3);
  v_incentive numeric(10, 3) := 0;
  v_tier_lines jsonb;
  v_override_amount numeric(10, 3) := -1;
  v_override_priority int := -1;
  v_override_rule_id uuid;
  v_deliveries_count int;
  v_wallet jsonb;
BEGIN
  SELECT jsonb_build_object(
    'driver_id', d.driver_id,
    'earn_date', d.earn_date,
    'deliveries', d.deliveries,
    'base_kwd', d.base_kwd,
    'incentive_kwd', d.incentive_kwd,
    'loan_deduction_kwd', d.loan_deduction_kwd,
    'penalty_kwd', d.penalty_kwd,
    'reimbursement_kwd', d.reimbursement_kwd,
    'net_kwd', d.net_kwd,
    'updated_at', d.updated_at
  )
  INTO v_daily
  FROM public.driver_earnings_daily d
  WHERE d.driver_id = p_driver_id AND d.earn_date = p_earn_date;

  SELECT jsonb_build_object(
    'id', w.id,
    'amount_kwd', w.amount_kwd,
    'status', w.status,
    'approved_at', w.approved_at,
    'source_ref', w.source_ref
  )
  INTO v_wallet
  FROM public.driver_wallet_entries w
  WHERE w.driver_id = p_driver_id
    AND w.earn_date = p_earn_date
    AND w.entry_type = 'earning_credit'
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', del.id,
        'external_order_id', del.external_order_id,
        'status', del.status,
        'delivered_at', del.delivered_at,
        'partner_id', del.partner_id,
        'partner_name', p.name,
        'restaurant_id', del.restaurant_id,
        'restaurant_name', r.name,
        'zone_id', del.zone_id,
        'zone_name', z.name,
        'counts_for_earnings', public.delivery_matches_rules(del.id, p_earn_date)
      )
      ORDER BY del.delivered_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_deliveries
  FROM public.deliveries del
  LEFT JOIN public.partners p ON p.id = del.partner_id
  LEFT JOIN public.restaurants r ON r.id = del.restaurant_id
  LEFT JOIN public.zones z ON z.id = del.zone_id
  WHERE del.driver_id = p_driver_id
    AND del.status = 'verified'
    AND (del.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date;

  SELECT count(*)::int INTO v_deliveries_count
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

      v_rules := v_rules || jsonb_build_array(jsonb_build_object(
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
        'amount_kwd', v_amount,
        'tiers', v_tier_lines
      ));
    END IF;
  END LOOP;

  IF v_override_amount >= 0 THEN
    v_incentive := v_override_amount;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object(
      'override_rule_id', v_override_rule_id,
      'note', 'override_applied',
      'final_incentive_kwd', v_override_amount
    ));
  END IF;

  RETURN jsonb_build_object(
    'driver_id', p_driver_id,
    'earn_date', p_earn_date,
    'daily', COALESCE(v_daily, 'null'::jsonb),
    'wallet', COALESCE(v_wallet, 'null'::jsonb),
    'eligible_deliveries_count', v_deliveries_count,
    'computed_incentive_kwd', v_incentive,
    'deliveries', v_deliveries,
    'rules', v_rules
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_driver_earnings_daily(
  p_start_date date,
  p_end_date date,
  p_driver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY row_data->>'earn_date' DESC, row_data->>'driver_name'),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', e.id,
      'driver_id', e.driver_id,
      'driver_code', dr.driver_code,
      'driver_name', COALESCE(pr.full_name, '—'),
      'earn_date', e.earn_date,
      'deliveries', e.deliveries,
      'base_kwd', e.base_kwd,
      'incentive_kwd', e.incentive_kwd,
      'loan_deduction_kwd', e.loan_deduction_kwd,
      'penalty_kwd', e.penalty_kwd,
      'reimbursement_kwd', e.reimbursement_kwd,
      'net_kwd', e.net_kwd,
      'wallet_amount_kwd', w.amount_kwd,
      'wallet_status', w.status
    ) AS row_data
    FROM public.driver_earnings_daily e
    JOIN public.drivers dr ON dr.id = e.driver_id
    JOIN public.profiles pr ON pr.id = e.driver_id
    LEFT JOIN public.driver_wallet_entries w
      ON w.driver_id = e.driver_id
      AND w.earn_date = e.earn_date
      AND w.entry_type = 'earning_credit'
    WHERE e.earn_date BETWEEN p_start_date AND p_end_date
      AND (p_driver_id IS NULL OR e.driver_id = p_driver_id)
  ) sub;

  RETURN jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'rows', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_driver_wallet_earning_credit(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_driver_earnings(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_earnings_for_range(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_earnings_detail(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_driver_earnings_daily(date, date, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.sync_driver_wallet_earning_credit(uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_driver_earnings(uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_earnings_for_range(date, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_driver_earnings_detail(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_driver_earnings_daily(date, date, uuid) TO service_role;

-- Audit permissions (catalog sync + role grants)
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('audit.view', 'View activity logs', 'admin'),
  ('audit.export', 'Export activity logs', 'admin')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'super_admin'
  AND p.slug IN ('audit.view', 'audit.export')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'administrator'
  AND p.slug IN ('audit.view', 'audit.export')
ON CONFLICT DO NOTHING;
