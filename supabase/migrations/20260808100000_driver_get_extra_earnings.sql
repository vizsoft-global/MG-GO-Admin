-- Driver app Extra Earnings + home quest card RPC.
-- Was applied manually on testing but never shipped to production.

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
  v_target int;
  v_remaining int;
  v_full_reward numeric(10, 3);
  v_current_reward numeric(10, 3);
  v_scope_label text;
  v_offers jsonb := '[]'::jsonb;
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

    IF v_rule.target_mode = 'tiered' THEN
      SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
      INTO v_target
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id;
    ELSE
      v_target := COALESCE(v_rule.target_deliveries, 0);
    END IF;

    v_remaining := GREATEST(0, v_target - v_eligible);

    v_full_reward := COALESCE(
      v_rule.reward_kwd,
      public.compute_incentive_amount(v_rule.id, v_target),
      0
    );

    v_current_reward := COALESCE(
      public.compute_incentive_amount(v_rule.id, v_eligible),
      0
    );

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

    v_offers := v_offers || jsonb_build_object(
      'rule_id', v_rule.id,
      'name', v_rule.name,
      'period', v_rule.period,
      'scope_type', v_rule.scope_type,
      'scope_label', v_scope_label,
      'current_count', v_eligible,
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
    );
  END LOOP;

  RETURN jsonb_build_object('active_offers', v_offers);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;
