-- Ops audit backend fixes: security events RPC, delivery idempotency,
-- drop insecure device-guard bypass overloads, published restaurant gate,
-- weekly/monthly incentive accrual (once per period).

-- ---------------------------------------------------------------------------
-- Driver security events (driver app zone_timeout_checkout contract)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_security_events_driver_created_idx
  ON public.driver_security_events (driver_id, created_at DESC);

ALTER TABLE public.driver_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_security_events_driver_insert ON public.driver_security_events;
CREATE POLICY driver_security_events_driver_insert
  ON public.driver_security_events
  FOR INSERT
  TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_security_events_admin_select ON public.driver_security_events;
CREATE POLICY driver_security_events_admin_select
  ON public.driver_security_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

CREATE OR REPLACE FUNCTION public.driver_log_security_event(
  p_event_type text,
  p_severity text DEFAULT 'warning',
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_severity text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_event_type IS NULL OR trim(p_event_type) = '' THEN
    RAISE EXCEPTION 'event_type_required';
  END IF;

  v_severity := lower(coalesce(nullif(trim(p_severity), ''), 'warning'));
  IF v_severity NOT IN ('low', 'medium', 'high', 'warning') THEN
    RAISE EXCEPTION 'invalid_severity';
  END IF;

  INSERT INTO public.driver_security_events (driver_id, event_type, severity, context)
  VALUES (v_uid, trim(p_event_type), v_severity, coalesce(p_context, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_log_security_event(text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Published + active restaurant required for driver activation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_has_active_restaurant(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_restaurants dr
    JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = p_driver_id
      AND r.is_active = true
      AND r.status = 'published'::public.restaurant_status
  );
$$;

-- ---------------------------------------------------------------------------
-- Kuwait period end helpers (incentive accrual once per period)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kuwait_week_end(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.kuwait_week_start(p_date) + 6;
$$;

CREATE OR REPLACE FUNCTION public.kuwait_month_end(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (date_trunc('month', p_date::timestamp) + interval '1 month' - interval '1 day')::date;
$$;

CREATE OR REPLACE FUNCTION public.incentive_accrues_on_date(
  p_period public.incentive_period,
  p_earn_date date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_period
    WHEN 'daily'::public.incentive_period THEN true
    WHEN 'weekly'::public.incentive_period THEN p_earn_date = public.kuwait_week_end(p_earn_date)
    WHEN 'monthly'::public.incentive_period THEN p_earn_date = public.kuwait_month_end(p_earn_date)
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent complete / cancel + drop pre-device-guard overloads
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.driver_create_pickup(text, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.driver_complete_delivery(uuid, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.driver_cancel_delivery(uuid, text, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.driver_complete_delivery(
  p_delivery_id uuid,
  p_delivery_proof_url text DEFAULT NULL::text,
  p_delivered_lat numeric DEFAULT NULL::numeric,
  p_delivered_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    RETURN v_row;
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET order_proof_url = NULLIF(trim(p_delivery_proof_url), ''),
      delivered_at = now(),
      delivered_lat = p_delivered_lat,
      delivered_lng = p_delivered_lng,
      status = 'pending'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_cancel_delivery(
  p_delivery_id uuid,
  p_cancel_reason text DEFAULT NULL::text,
  p_cancel_proof_url text DEFAULT NULL::text,
  p_cancel_lat numeric DEFAULT NULL::numeric,
  p_cancel_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deliveries%ROWTYPE;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  v_reason := NULLIF(trim(p_cancel_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'cancel_reason_required';
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    RETURN v_row;
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  UPDATE public.deliveries
  SET cancel_reason = v_reason,
      cancel_proof_url = NULLIF(trim(p_cancel_proof_url), ''),
      cancelled_at = now(),
      cancel_lat = p_cancel_lat,
      cancel_lng = p_cancel_lng,
      status = 'cancelled'::public.delivery_status,
      updated_at = now()
  WHERE id = p_delivery_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.driver_complete_delivery(uuid, text, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_cancel_delivery(uuid, text, text, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_create_pickup(text, text, numeric, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Recalculate earnings: weekly/monthly incentives accrue once per period
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
    v_accrues := public.incentive_accrues_on_date(v_rule.period, p_earn_date);

    v_eligible_count := public.count_eligible_deliveries(
      p_driver_id,
      p_earn_date,
      v_rule.id
    );

    v_rule_amount := public.compute_incentive_amount(v_rule.id, v_eligible_count);

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
