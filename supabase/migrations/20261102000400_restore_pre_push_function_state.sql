-- P1 safety fix (2026-10-02). This migration applies nothing new: it restores
-- the exact function definitions production was serving before the P1/P2 push.
--
-- `supabase db push --include-all` also applied `20261028300000` and
-- `20261028400000`, whose ledger rows were missing on the remote and which had
-- therefore never run. Among the files applied was `20261030600000`, written
-- later specifically to land the 283 objects "despite the ledger row"; running
-- it again on top of `20261030800000` reverted two definitions 308 superseded.
--
-- 1. `driver_get_home_dashboard` -- 308 wraps the weekly incentive banner in
--    `IF NOT public.company_config_applies(...)`, so a company (outsourced)
--    rider sees no restaurant incentive banner. 306 predates that branch and
--    re-running it removed the guard. Restored verbatim from 308 (lines 945-1190).
--
-- 2. `report_delivery_orders(date, date, time, time)` -- 284 adds an
--    "operational day" mode that activates whenever From time is not 00:00.
--    The default 00:00 path is provably identical to 20261012100000, but the
--    feature was deliberately withheld ("the 05:00 report stays inert until the
--    two migrations apply"), so the pre-push definition is restored verbatim
--    from 20261012100000 (lines 6-203). Re-applying 284 turns it back on.
--
-- Nothing else moves: `deliveries.shift_date`, `deliveries_stamp_shift_date`,
-- `delivery_shift_date` and `deliveries_driver_shift_date_idx` that 283
-- re-created are equivalent to the 306 versions already live, and
-- `_driver_daily_dpd_state` was subsequently rewritten (sargable, company
-- logic preserved) by `20261102000300`. The 283/284/306 ledger rows are kept
-- deliberately so a future `db push` cannot run them a third time.

CREATE OR REPLACE FUNCTION public.report_delivery_orders(
  p_from date,
  p_to date,
  p_from_time time DEFAULT '00:00:00',
  p_to_time time DEFAULT '23:59:00'
)
RETURNS TABLE (
  driver_id uuid,
  driver_code text,
  employee_id text,
  full_name text,
  store_name text,
  shift_date date,
  delivery_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_shift_from date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF p_from = p_to
     AND COALESCE(p_from_time, time '00:00:00') > COALESCE(p_to_time, time '23:59:00') THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF (p_to - p_from) + 1 > 366 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_from_ts := (
    p_from::timestamp + COALESCE(p_from_time, time '00:00:00')
  ) AT TIME ZONE 'Asia/Kuwait';
  -- Inclusive through the selected to-minute (18:00 â†’ 18:00:59.999).
  v_to_ts := (
    (
      p_to::timestamp
      + COALESCE(p_to_time, time '23:59:00')
      + interval '1 minute'
    ) AT TIME ZONE 'Asia/Kuwait'
  ) - interval '1 millisecond';

  IF v_from_ts > v_to_ts THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  v_shift_from := p_from - 1;

  RETURN QUERY
  WITH shift_windows AS MATERIALIZED (
    SELECT
      s.driver_id,
      s.shift_date,
      public.shift_session_instant(s.shift_date, s.session1_start, 0) AS window_start,
      public.shift_session_instant(
        s.shift_date,
        s.session1_end,
        s.session1_end_day_offset
      ) AS window_end
    FROM public.driver_daily_shifts s
    WHERE s.shift_date BETWEEN v_shift_from AND p_to

    UNION ALL

    SELECT
      s.driver_id,
      s.shift_date,
      public.shift_session_instant(
        s.shift_date,
        s.session2_start,
        s.session2_start_day_offset
      ) AS window_start,
      public.shift_session_instant(
        s.shift_date,
        s.session2_end,
        s.session2_end_day_offset
      ) AS window_end
    FROM public.driver_daily_shifts s
    WHERE s.shift_type = 'split'
      AND s.session2_start IS NOT NULL
      AND s.session2_end IS NOT NULL
      AND s.shift_date BETWEEN v_shift_from AND p_to
  ),
  candidate_deliveries AS MATERIALIZED (
    SELECT
      d.id,
      d.driver_id,
      d.delivered_at
    FROM public.deliveries d
    WHERE d.delivered_at IS NOT NULL
      AND d.delivered_at >= v_from_ts
      AND d.delivered_at <= v_to_ts
      AND d.status NOT IN ('rejected', 'cancelled')
  ),
  matched_in_window AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
     AND cd.delivered_at >= sw.window_start
     AND cd.delivered_at < sw.window_end
    ORDER BY cd.id, sw.window_start
  ),
  matched_prev AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
     AND sw.window_start <= cd.delivered_at
    WHERE NOT EXISTS (
      SELECT 1 FROM matched_in_window m WHERE m.id = cd.id
    )
    ORDER BY cd.id, sw.window_start DESC
  ),
  matched_nearest AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
    WHERE NOT EXISTS (
      SELECT 1 FROM matched_in_window m WHERE m.id = cd.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM matched_prev p WHERE p.id = cd.id
      )
    ORDER BY cd.id, ABS(EXTRACT(EPOCH FROM (cd.delivered_at - sw.window_start)))
  ),
  attributed AS MATERIALIZED (
    SELECT
      cd.driver_id,
      COALESCE(
        iw.shift_date,
        pw.shift_date,
        nw.shift_date,
        (cd.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
      ) AS attributed_date
    FROM candidate_deliveries cd
    LEFT JOIN matched_in_window iw ON iw.id = cd.id
    LEFT JOIN matched_prev pw ON pw.id = cd.id
    LEFT JOIN matched_nearest nw ON nw.id = cd.id
  ),
  aggregated AS (
    SELECT
      a.driver_id,
      a.attributed_date AS shift_date,
      COUNT(*)::bigint AS delivery_count
    FROM attributed a
    WHERE a.attributed_date BETWEEN p_from AND p_to
    GROUP BY a.driver_id, a.attributed_date
  ),
  driver_stores AS MATERIALIZED (
    SELECT
      drs.driver_id,
      MIN(r.name) AS store_name
    FROM public.driver_restaurants drs
    JOIN public.restaurants r ON r.id = drs.restaurant_id
    WHERE r.status = 'published'
    GROUP BY drs.driver_id
  )
  SELECT
    agg.driver_id,
    dr.driver_code,
    dr.employee_id,
    COALESCE(p.full_name, 'â€”') AS full_name,
    COALESCE(ds.store_name, 'â€”') AS store_name,
    agg.shift_date,
    agg.delivery_count
  FROM aggregated agg
  JOIN public.drivers dr ON dr.id = agg.driver_id
  LEFT JOIN public.profiles p ON p.id = dr.id
  LEFT JOIN driver_stores ds ON ds.driver_id = agg.driver_id
  ORDER BY p.full_name ASC NULLS LAST, agg.shift_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.report_delivery_orders(date, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_delivery_orders(date, date, time, time) TO authenticated;

COMMENT ON FUNCTION public.report_delivery_orders(date, date, time, time) IS
  'Per-driver per-shift-day delivery counts for the Orders Report matrix export. delivered_at is clipped to the Kuwait from/to clock (to-minute inclusive). Shift attribution is unchanged. Max 366 inclusive days.';

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

