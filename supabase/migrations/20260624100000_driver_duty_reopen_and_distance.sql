-- Driver duty + distance enhancements:
-- 1) Same-day re-online reopens shift (clears check_out_at)
-- 2) Persist distance traveled at checkout
-- 3) Track and return distance_today_meters from live location updates

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS distance_today_meters numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS distance_meters numeric(12, 2);

CREATE OR REPLACE FUNCTION public.driver_report_location(
  p_latitude numeric,
  p_longitude numeric,
  p_speed_mps numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_battery_pct smallint DEFAULT NULL,
  p_tracking_status text DEFAULT 'idle',
  p_delivery_id uuid DEFAULT NULL,
  p_force_history boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_prev public.driver_locations%ROWTYPE;
  v_last_event public.driver_location_events%ROWTYPE;
  v_in_range boolean;
  v_zone_status text;
  v_proximity integer;
  v_history_written boolean := false;
  v_now timestamptz := now();
  v_now_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_dist_m double precision;
  v_secs_since_event double precision;
  v_status text := lower(trim(coalesce(p_tracking_status, 'idle')));
  v_segment_m double precision := 0;
  v_distance_today numeric(12, 2) := 0;
  v_is_moving boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_status NOT IN ('idle', 'moving', 'delivery_submit') THEN
    RAISE EXCEPTION 'invalid_tracking_status';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  IF NOT v_driver.is_on_duty THEN
    RAISE EXCEPTION 'driver_off_duty' USING MESSAGE = 'Location tracking requires on-duty status';
  END IF;

  IF v_status = 'delivery_submit' AND p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery_id_required';
  END IF;

  SELECT * INTO v_prev FROM public.driver_locations WHERE driver_id = v_uid;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity <= 0 THEN
    v_in_range := true;
    v_zone_status := 'unknown';
  ELSE
    v_in_range := public.driver_is_within_delivery_range(
      v_uid,
      p_latitude::double precision,
      p_longitude::double precision,
      v_proximity
    );
    v_zone_status := CASE WHEN v_in_range THEN 'in_zone' ELSE 'out_of_zone' END;
  END IF;

  v_is_moving := (
    v_status IN ('moving', 'delivery_submit')
    OR (p_speed_mps IS NOT NULL AND p_speed_mps >= 1)
  );

  IF v_prev.driver_id IS NOT NULL THEN
    IF (v_prev.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date = v_now_day THEN
      v_segment_m := public._haversine_meters(
        v_prev.latitude::double precision,
        v_prev.longitude::double precision,
        p_latitude::double precision,
        p_longitude::double precision
      );

      IF NOT v_is_moving THEN
        v_segment_m := 0;
      ELSIF v_segment_m < 0 OR v_segment_m > 500 THEN
        v_segment_m := 0;
      END IF;

      v_distance_today := COALESCE(v_prev.distance_today_meters, 0) + COALESCE(v_segment_m, 0);
    ELSE
      v_distance_today := 0;
    END IF;
  END IF;

  INSERT INTO public.driver_locations (
    driver_id,
    latitude,
    longitude,
    speed_mps,
    accuracy_meters,
    battery_pct,
    tracking_status,
    zone_status,
    distance_today_meters,
    last_seen_at,
    updated_at
  ) VALUES (
    v_uid,
    p_latitude,
    p_longitude,
    p_speed_mps,
    p_accuracy_meters,
    p_battery_pct,
    v_status,
    v_zone_status,
    v_distance_today,
    v_now,
    v_now
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    speed_mps = EXCLUDED.speed_mps,
    accuracy_meters = EXCLUDED.accuracy_meters,
    battery_pct = EXCLUDED.battery_pct,
    tracking_status = EXCLUDED.tracking_status,
    zone_status = EXCLUDED.zone_status,
    distance_today_meters = EXCLUDED.distance_today_meters,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at;

  SELECT *
  INTO v_last_event
  FROM public.driver_location_events
  WHERE driver_id = v_uid
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF p_force_history OR v_status = 'delivery_submit' THEN
    v_history_written := true;
  ELSIF v_last_event.id IS NULL THEN
    v_history_written := true;
  ELSIF v_last_event.tracking_status IS DISTINCT FROM v_status THEN
    v_history_written := true;
  ELSE
    v_dist_m := public._haversine_meters(
      v_last_event.latitude::double precision,
      v_last_event.longitude::double precision,
      p_latitude::double precision,
      p_longitude::double precision
    );
    v_secs_since_event := extract(epoch FROM (v_now - v_last_event.recorded_at));
    IF v_dist_m >= 75 OR v_secs_since_event >= 300 THEN
      v_history_written := true;
    END IF;
  END IF;

  IF v_history_written THEN
    INSERT INTO public.driver_location_events (
      driver_id,
      latitude,
      longitude,
      speed_mps,
      accuracy_meters,
      battery_pct,
      tracking_status,
      zone_status,
      delivery_id,
      recorded_at
    ) VALUES (
      v_uid,
      p_latitude,
      p_longitude,
      p_speed_mps,
      p_accuracy_meters,
      p_battery_pct,
      v_status,
      v_zone_status,
      p_delivery_id,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'zone_status', v_zone_status,
    'in_range', v_in_range,
    'last_seen_at', v_now,
    'history_written', v_history_written,
    'tracking_status', v_status,
    'speed_mps', p_speed_mps,
    'distance_today_meters', v_distance_today
  );
END;
$$;

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
  v_log_date date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_distance_today numeric(12, 2) := 0;
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

  SELECT COALESCE(dl.distance_today_meters, 0)
  INTO v_distance_today
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_driver_id;

  IF p_is_online THEN
    IF v_open_session_id IS NULL THEN
      INSERT INTO public.driver_sessions (driver_id, is_online, went_online_at)
      VALUES (v_driver_id, true, now());
    ELSE
      UPDATE public.driver_sessions
      SET updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    INSERT INTO public.attendance_logs (driver_id, log_date, check_in_at, status)
    VALUES (v_driver_id, v_log_date, now(), 'present')
    ON CONFLICT (driver_id, log_date) DO UPDATE
      SET check_in_at = COALESCE(attendance_logs.check_in_at, EXCLUDED.check_in_at),
          check_out_at = NULL,
          status = CASE
            WHEN attendance_logs.status = 'on_leave' THEN attendance_logs.status
            ELSE 'present'
          END,
          updated_at = now();
  ELSE
    IF v_open_session_id IS NOT NULL THEN
      UPDATE public.driver_sessions
      SET is_online = false,
          went_offline_at = now(),
          updated_at = now()
      WHERE id = v_open_session_id;
    END IF;

    UPDATE public.attendance_logs
    SET check_out_at = now(),
        distance_meters = v_distance_today,
        updated_at = now()
    WHERE driver_id = v_driver_id
      AND log_date = v_log_date
      AND check_out_at IS NULL;
  END IF;

  IF NOT p_is_on_duty THEN
    DELETE FROM public.driver_locations WHERE driver_id = v_driver_id;
  END IF;

  RETURN public.driver_get_home_dashboard();
END;
$$;

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
  v_speed_mps numeric(8, 3);
  v_distance_today_meters numeric(12, 2);
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
