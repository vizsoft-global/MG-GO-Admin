-- Shift-day attribution for rider Home / My Deliveries.
-- Same rule as report_delivery_orders: in-window [start, end) → previous
-- start ≤ at → nearest start → Kuwait calendar date.
-- Only inspects shift_date in [kd-1, kd]. Exact end is not in-window; a next
-- shift that starts then wins. Overlap picks the earliest window_start.
-- Fallback when no candidate shift exists: Kuwait calendar date of p_at.
-- Known limitation: editing a shift later does not restamp existing rows.

CREATE OR REPLACE FUNCTION public.delivery_shift_date(
  p_driver uuid,
  p_at timestamptz
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kd date;
  v_date date;
BEGIN
  IF p_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_kd := (p_at AT TIME ZONE 'Asia/Kuwait')::date;

  IF p_driver IS NULL THEN
    RETURN v_kd;
  END IF;

  SELECT w.shift_date
  INTO v_date
  FROM (
    SELECT
      s.shift_date,
      public.shift_session_instant(s.shift_date, s.session1_start, 0) AS window_start,
      public.shift_session_instant(
        s.shift_date,
        s.session1_end,
        s.session1_end_day_offset
      ) AS window_end,
      1 AS session_no
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd

    UNION ALL

    SELECT
      s.shift_date,
      public.shift_session_instant(
        s.shift_date,
        s.session2_start,
        s.session2_start_day_offset
      ),
      public.shift_session_instant(
        s.shift_date,
        s.session2_end,
        s.session2_end_day_offset
      ),
      2
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_type = 'split'
      AND s.session2_start IS NOT NULL
      AND s.session2_end IS NOT NULL
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd
  ) w
  WHERE p_at >= w.window_start
    AND p_at < w.window_end
  ORDER BY w.window_start, w.shift_date, w.session_no
  LIMIT 1;

  IF v_date IS NOT NULL THEN
    RETURN v_date;
  END IF;

  SELECT w.shift_date
  INTO v_date
  FROM (
    SELECT
      s.shift_date,
      public.shift_session_instant(s.shift_date, s.session1_start, 0) AS window_start,
      1 AS session_no
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd

    UNION ALL

    SELECT
      s.shift_date,
      public.shift_session_instant(
        s.shift_date,
        s.session2_start,
        s.session2_start_day_offset
      ),
      2
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_type = 'split'
      AND s.session2_start IS NOT NULL
      AND s.session2_end IS NOT NULL
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd
  ) w
  WHERE w.window_start <= p_at
  ORDER BY w.window_start DESC, w.shift_date DESC, w.session_no DESC
  LIMIT 1;

  IF v_date IS NOT NULL THEN
    RETURN v_date;
  END IF;

  SELECT w.shift_date
  INTO v_date
  FROM (
    SELECT
      s.shift_date,
      public.shift_session_instant(s.shift_date, s.session1_start, 0) AS window_start,
      1 AS session_no
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd

    UNION ALL

    SELECT
      s.shift_date,
      public.shift_session_instant(
        s.shift_date,
        s.session2_start,
        s.session2_start_day_offset
      ),
      2
    FROM public.driver_daily_shifts s
    WHERE s.driver_id = p_driver
      AND s.shift_type = 'split'
      AND s.session2_start IS NOT NULL
      AND s.session2_end IS NOT NULL
      AND s.shift_date BETWEEN (v_kd - 1) AND v_kd
  ) w
  ORDER BY ABS(EXTRACT(EPOCH FROM (p_at - w.window_start))), w.window_start, w.shift_date, w.session_no
  LIMIT 1;

  RETURN COALESCE(v_date, v_kd);
END;
$$;

COMMENT ON FUNCTION public.delivery_shift_date(uuid, timestamptz) IS
  'Maps a delivery instant to a shift_date. In-window [start,end) then previous then nearest then Kuwait date. Candidates are only kd-1 and kd. Null p_at → null; missing driver/shift → Kuwait date.';

REVOKE ALL ON FUNCTION public.delivery_shift_date(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_shift_date(uuid, timestamptz) TO authenticated;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS shift_date date;

COMMENT ON COLUMN public.deliveries.shift_date IS
  'Shift day from delivery_shift_date(). Not restamped when an admin later edits driver_daily_shifts. Null only if delivered_at, pickup_at and created_at are all null.';

CREATE INDEX IF NOT EXISTS deliveries_driver_shift_date_idx
  ON public.deliveries (driver_id, shift_date);

CREATE OR REPLACE FUNCTION public.deliveries_stamp_shift_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.shift_date := public.delivery_shift_date(
    NEW.driver_id,
    COALESCE(NEW.delivered_at, NEW.pickup_at, NEW.created_at)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deliveries_stamp_shift_date ON public.deliveries;
CREATE TRIGGER deliveries_stamp_shift_date
BEFORE INSERT OR UPDATE OF driver_id, pickup_at, delivered_at
ON public.deliveries
FOR EACH ROW
EXECUTE FUNCTION public.deliveries_stamp_shift_date();

DO $$
DECLARE
  v_last uuid := '00000000-0000-0000-0000-000000000000';
  v_batch uuid[];
  v_n int;
BEGIN
  LOOP
    SELECT ARRAY(
      SELECT d.id
      FROM public.deliveries d
      WHERE d.id > v_last
      ORDER BY d.id
      LIMIT 2000
    )
    INTO v_batch;

    v_n := COALESCE(array_length(v_batch, 1), 0);
    EXIT WHEN v_n = 0;

    UPDATE public.deliveries d
    SET shift_date = public.delivery_shift_date(
      d.driver_id,
      COALESCE(d.delivered_at, d.pickup_at, d.created_at)
    )
    WHERE d.id = ANY (v_batch);

    v_last := v_batch[v_n];
  END LOOP;
END
$$;

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
    'banner', v_banner,
    'force_app_update', v_force_app_update,
    'force_app_update_min_code', v_force_min
  );
END;
$function$;
