-- Home progress_count (submitted orders) stays separate from verified-only pay.
-- Bulk verify/reject on /deliveries is one set-based write + one earnings recalc
-- per driver-day.

CREATE OR REPLACE FUNCTION public.delivery_progress_matches_rules(
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
  v_restaurant_id uuid;
BEGIN
  SELECT d.id, d.driver_id, d.zone_id, d.partner_id, d.restaurant_id,
         d.pickup_lat, d.pickup_lng, d.status,
         (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date AS deliver_date,
         (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date AS pickup_date
  INTO v_delivery
  FROM public.deliveries d
  WHERE d.id = p_delivery_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_delivery.status NOT IN ('in_transit', 'pending', 'under_review', 'verified') THEN
    RETURN false;
  END IF;

  v_check_date := COALESCE(p_on_date, v_delivery.deliver_date, v_delivery.pickup_date);
  v_restaurant_id := public.delivery_scope_restaurant_id(
    v_delivery.restaurant_id,
    v_delivery.driver_id,
    v_delivery.pickup_lat::double precision,
    v_delivery.pickup_lng::double precision
  );

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
          OR (dr.scope_type = 'restaurant' AND s.restaurant_id = v_restaurant_id)
        )
    );

  RETURN v_match_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_progress_matches_rules(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_progress_matches_rules(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_progress_matches_rules(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.count_progress_deliveries(
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
    AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
    AND COALESCE(
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
      (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
    ) BETWEEN v_period_start AND v_period_end
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
$$;

REVOKE ALL ON FUNCTION public.count_progress_deliveries(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_progress_deliveries(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_progress_deliveries(uuid, date, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._delivery_resolve_restaurant_id(
  p_driver_id uuid,
  p_partner_id uuid,
  p_restaurant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned uuid[];
  v_n int;
  v_id uuid;
BEGIN
  IF p_restaurant_id IS NOT NULL THEN
    RETURN p_restaurant_id;
  END IF;

  SELECT COALESCE(array_agg(restaurant_id), '{}')
  INTO v_assigned
  FROM public.driver_restaurants
  WHERE driver_id = p_driver_id
    AND restaurant_id IS NOT NULL;

  IF p_partner_id IS NULL AND cardinality(v_assigned) = 1 THEN
    RETURN v_assigned[1];
  END IF;

  IF p_partner_id IS NOT NULL AND cardinality(v_assigned) > 0 THEN
    SELECT count(*)::int INTO v_n
    FROM public.restaurants r
    WHERE r.id = ANY (v_assigned)
      AND r.partner_id = p_partner_id;
    IF v_n = 1 THEN
      SELECT r.id INTO v_id
      FROM public.restaurants r
      WHERE r.id = ANY (v_assigned)
        AND r.partner_id = p_partner_id;
      RETURN v_id;
    END IF;
  END IF;

  IF p_partner_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::int INTO v_n
  FROM public.restaurants r
  WHERE r.partner_id = p_partner_id;
  IF v_n = 1 THEN
    SELECT r.id INTO v_id
    FROM public.restaurants r
    WHERE r.partner_id = p_partner_id
    ORDER BY r.created_at ASC
    LIMIT 1;
    RETURN v_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._delivery_resolve_restaurant_id(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._delivery_resolve_restaurant_id(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._delivery_resolve_restaurant_id(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_bulk_update_deliveries(
  p_ids uuid[],
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_requested int;
  v_updated int := 0;
  v_reason text;
  v_rec record;
  v_earn_date date;
BEGIN
  IF NOT public.is_admin_panel_user()
     OR NOT public.staff_has_permission('deliveries.manage') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF p_status = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}')
  INTO v_ids
  FROM unnest(COALESCE(p_ids, '{}')) AS x
  WHERE x IS NOT NULL;

  v_requested := COALESCE(cardinality(v_ids), 0);
  IF v_requested = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'skipped', 0, 'failed', 0);
  END IF;
  IF v_requested > 100 THEN
    RAISE EXCEPTION 'too_many';
  END IF;

  WITH changed AS (
    UPDATE public.deliveries d
    SET
      status = p_status::public.delivery_status,
      rejection_reason = CASE
        WHEN p_status = 'rejected' THEN v_reason
        ELSE NULL
      END,
      restaurant_id = CASE
        WHEN p_status = 'verified' THEN COALESCE(
          d.restaurant_id,
          public._delivery_resolve_restaurant_id(
            d.driver_id,
            d.partner_id,
            d.restaurant_id
          )
        )
        ELSE d.restaurant_id
      END,
      updated_at = now()
    WHERE d.id = ANY (v_ids)
      AND d.status IN ('pending', 'under_review')
    RETURNING d.driver_id, d.delivered_at, d.pickup_at
  )
  SELECT count(*)::int INTO v_updated FROM changed;

  FOR v_rec IN
    SELECT DISTINCT
      c.driver_id,
      (
        COALESCE(c.delivered_at, c.pickup_at) AT TIME ZONE 'Asia/Kuwait'
      )::date AS earn_date
    FROM (
      SELECT d.driver_id, d.delivered_at, d.pickup_at
      FROM public.deliveries d
      WHERE d.id = ANY (v_ids)
        AND d.status = p_status::public.delivery_status
    ) c
    WHERE COALESCE(c.delivered_at, c.pickup_at) IS NOT NULL
      AND p_status = 'verified'
  LOOP
    v_earn_date := v_rec.earn_date;
    IF v_earn_date IS NOT NULL THEN
      PERFORM public.recalculate_driver_earnings(v_rec.driver_id, v_earn_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped', GREATEST(0, v_requested - v_updated),
    'failed', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_update_deliveries(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_update_deliveries(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_update_deliveries(uuid[], text, text) TO service_role;

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
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
      (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
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
    'banner', v_banner
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_home_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_home_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_home_dashboard() TO service_role;

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
    );
  END LOOP;

  RETURN jsonb_build_object('active_offers', v_offers);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_extra_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_extra_earnings() TO service_role;
