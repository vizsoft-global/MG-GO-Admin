-- Driver home dashboard: RLS for sessions/restaurants/rules + dashboard + duty RPCs.

-- ---------------------------------------------------------------------------
-- RLS: driver_sessions (own rows)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_sessions_own_select ON public.driver_sessions;
CREATE POLICY driver_sessions_own_select ON public.driver_sessions
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_sessions_own_insert ON public.driver_sessions;
CREATE POLICY driver_sessions_own_insert ON public.driver_sessions
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_sessions_own_update ON public.driver_sessions;
CREATE POLICY driver_sessions_own_update ON public.driver_sessions
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: driver_restaurants (read own assignments)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_restaurants_own_select ON public.driver_restaurants;
CREATE POLICY driver_restaurants_own_select ON public.driver_restaurants
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: delivery_rules + scopes (read rules applicable to driver)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_read_delivery_rules ON public.delivery_rules;
CREATE POLICY driver_read_delivery_rules ON public.delivery_rules
  FOR SELECT TO authenticated
  USING (
    status = 'active'
    AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN start_date AND end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s
      JOIN public.drivers dr ON dr.id = auth.uid()
      WHERE s.delivery_rule_id = delivery_rules.id
        AND (
          (delivery_rules.scope_type = 'zone' AND s.zone_id = dr.zone_id)
          OR (delivery_rules.scope_type = 'partner' AND s.partner_id = dr.partner_id)
          OR (
            delivery_rules.scope_type = 'restaurant'
            AND s.restaurant_id IN (
              SELECT dr2.restaurant_id
              FROM public.driver_restaurants dr2
              WHERE dr2.driver_id = auth.uid()
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS driver_read_delivery_rule_scopes ON public.delivery_rule_scopes;
CREATE POLICY driver_read_delivery_rule_scopes ON public.delivery_rule_scopes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.delivery_rules dr
      WHERE dr.id = delivery_rule_scopes.delivery_rule_id
        AND dr.status = 'active'
        AND (now() AT TIME ZONE 'Asia/Kuwait')::date BETWEEN dr.start_date AND dr.end_date
    )
  );

-- ---------------------------------------------------------------------------
-- Helper: incentive rule applies to driver context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.incentive_rule_matches_driver(
  p_rule_id uuid,
  p_driver_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.incentive_rule_scopes s
    JOIN public.incentive_rules ir ON ir.id = s.incentive_rule_id
    JOIN public.drivers dr ON dr.id = p_driver_id
    WHERE ir.id = p_rule_id
      AND (
        (ir.scope_type = 'zone' AND s.zone_id = dr.zone_id)
        OR (ir.scope_type = 'partner' AND s.partner_id = dr.partner_id)
        OR (
          ir.scope_type = 'restaurant'
          AND s.restaurant_id IN (
            SELECT dr2.restaurant_id
            FROM public.driver_restaurants dr2
            WHERE dr2.driver_id = p_driver_id
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: driver_get_home_dashboard()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_get_home_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_target int;
  v_remaining int;
  v_reward numeric(10, 3);
  v_tiers jsonb;
  v_earnings numeric(10, 3);
  v_deliveries int;
  v_online_seconds bigint;
  v_is_online boolean := false;
  v_went_online_at timestamptz;
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
  )
  INTO v_driver
  FROM public.drivers dr
  JOIN public.profiles pr ON pr.id = dr.id
  LEFT JOIN public.partners pt ON pt.id = dr.partner_id
  WHERE dr.id = v_driver_id;

  SELECT ds.is_online, ds.went_online_at
  INTO v_is_online, v_went_online_at
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
  ORDER BY ds.updated_at DESC NULLS LAST, ds.created_at DESC
  LIMIT 1;

  v_is_online := COALESCE(v_is_online, false);

  v_session := jsonb_build_object(
    'is_online', v_is_online,
    'went_online_at', v_went_online_at
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
    AND d.status = 'verified'
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN v_week_start AND v_week_end;

  SELECT COALESCE(SUM(
    GREATEST(
      0,
      EXTRACT(
        EPOCH FROM (
          LEAST(
            COALESCE(ds.went_offline_at, now()),
            ((v_week_end + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
          )
          - GREATEST(
            ds.went_online_at,
            (v_week_start::timestamp AT TIME ZONE 'Asia/Kuwait')
          )
        )
      )
    )
  ), 0)::bigint
  INTO v_online_seconds
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.went_online_at IS NOT NULL
    AND ds.went_online_at < ((v_week_end + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
    AND COALESCE(ds.went_offline_at, now()) > (v_week_start::timestamp AT TIME ZONE 'Asia/Kuwait');

  v_week := jsonb_build_object(
    'start_date', v_week_start,
    'end_date', v_week_end,
    'earnings_kwd', v_earnings,
    'deliveries_count', v_deliveries,
    'online_seconds', v_online_seconds
  );

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

  IF v_rule.target_mode = 'tiered' THEN
      SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
      INTO v_target
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id;
    ELSE
      v_target := COALESCE(v_rule.target_deliveries, 0);
    END IF;

    v_remaining := GREATEST(0, v_target - v_eligible);
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
      'target', v_target,
      'reward_kwd', v_reward,
      'remaining_deliveries', v_remaining,
      'target_mode', v_rule.target_mode,
      'tiers', v_tiers
    );
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

  RETURN jsonb_build_object(
    'driver', v_driver,
    'session', v_session,
    'week', v_week,
    'primary_weekly_incentive', v_incentive,
    'delivery_rules', v_rules
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: driver_set_duty_state(p_is_on_duty, p_is_online)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_set_duty_state(
  p_is_on_duty boolean,
  p_is_online boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_open_session_id uuid;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.drivers
  SET is_on_duty = p_is_on_duty,
      updated_at = now()
  WHERE id = v_driver_id;

  SELECT ds.id
  INTO v_open_session_id
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
    AND ds.is_online = true
  ORDER BY ds.created_at DESC
  LIMIT 1;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, now());
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = now()
      WHERE id = v_open_session_id;
    END IF;
  ELSE
    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = now(),
          updated_at = now()
      WHERE id = v_open_session_id;
    END IF;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$$;

GRANT EXECUTE ON FUNCTION public.incentive_rule_matches_driver(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_home_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_set_duty_state(boolean, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.incentive_rule_matches_driver(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_home_dashboard() TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_set_duty_state(boolean, boolean) TO service_role;
