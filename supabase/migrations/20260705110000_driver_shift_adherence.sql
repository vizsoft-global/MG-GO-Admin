-- Shift adherence: compare actual In/Out vs submitted shift (session 1 start, last session end).

CREATE OR REPLACE FUNCTION public._driver_shift_adherence(
  p_driver_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.driver_daily_shifts%ROWTYPE;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_actual_in timestamptz;
  v_actual_out timestamptz;
  v_online_seconds integer := 0;
  v_scheduled_seconds integer;
  v_minutes_late integer;
  v_minutes_early_out integer;
BEGIN
  SELECT *
  INTO v_shift
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = p_driver_id
    AND ds.shift_date = p_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_scheduled_start := public.shift_session_instant(
    v_shift.shift_date,
    v_shift.session1_start,
    0
  );

  IF v_shift.shift_type = 'split'
    AND v_shift.session2_end IS NOT NULL THEN
    v_scheduled_end := public.shift_session_instant(
      v_shift.shift_date,
      v_shift.session2_end,
      COALESCE(v_shift.session2_end_day_offset, 0)
    );
  ELSE
    v_scheduled_end := public.shift_session_instant(
      v_shift.shift_date,
      v_shift.session1_end,
      v_shift.session1_end_day_offset
    );
  END IF;

  SELECT da.first_online_at, da.online_seconds
  INTO v_actual_in, v_online_seconds
  FROM public.driver_attendance da
  WHERE da.driver_id = p_driver_id
    AND da.attendance_date = p_date;

  SELECT al.check_out_at
  INTO v_actual_out
  FROM public.attendance_logs al
  WHERE al.driver_id = p_driver_id
    AND al.log_date = p_date;

  IF v_actual_in IS NULL THEN
    SELECT al.check_in_at
    INTO v_actual_in
    FROM public.attendance_logs al
    WHERE al.driver_id = p_driver_id
      AND al.log_date = p_date;
  END IF;

  v_scheduled_seconds := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_scheduled_end - v_scheduled_start))::integer
  );

  IF v_actual_in IS NOT NULL AND v_scheduled_start IS NOT NULL THEN
    v_minutes_late := GREATEST(
      0,
      (EXTRACT(EPOCH FROM (v_actual_in - v_scheduled_start)) / 60)::integer
    );
  ELSE
    v_minutes_late := 0;
  END IF;

  IF v_actual_out IS NOT NULL AND v_scheduled_end IS NOT NULL THEN
    v_minutes_early_out := GREATEST(
      0,
      (EXTRACT(EPOCH FROM (v_scheduled_end - v_actual_out)) / 60)::integer
    );
  ELSE
    v_minutes_early_out := 0;
  END IF;

  RETURN jsonb_build_object(
    'scheduled_start_at', v_scheduled_start,
    'scheduled_end_at', v_scheduled_end,
    'actual_in_at', v_actual_in,
    'actual_out_at', v_actual_out,
    'minutes_late', v_minutes_late,
    'minutes_early_out', v_minutes_early_out,
    'online_seconds', COALESCE(v_online_seconds, 0),
    'scheduled_seconds', v_scheduled_seconds
  );
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
  v_shift_adherence jsonb;
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

  v_shift_adherence := public._driver_shift_adherence(v_driver_id, v_today);

  RETURN jsonb_build_object(
    'driver', v_driver,
    'session', v_session,
    'week', v_week,
    'primary_weekly_incentive', v_incentive,
    'delivery_rules', v_rules,
    'shift_adherence', v_shift_adherence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_attendance(
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_elapsed integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_present integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  IF v_today < v_start THEN
    v_elapsed := 0;
  ELSIF v_today > v_end THEN
    v_elapsed := extract(day FROM v_end)::integer;
  ELSE
    v_elapsed := extract(day FROM v_today)::integer;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'attendance_date', da.attendance_date,
        'online_seconds', da.online_seconds
          + CASE
            WHEN ds.is_online = true
              AND da.attendance_date = v_today
              AND da.last_online_at IS NOT NULL
            THEN GREATEST(0, extract(epoch FROM ((now()) - da.last_online_at))::integer)
            ELSE 0
          END,
        'status', da.status,
        'is_validated', da.is_validated,
        'validation_source', da.validation_source,
        'shift_adherence', public._driver_shift_adherence(v_uid, da.attendance_date)
      )
      ORDER BY da.attendance_date
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.driver_attendance da
  LEFT JOIN LATERAL (
    SELECT s.is_online
    FROM public.driver_sessions s
    WHERE s.driver_id = da.driver_id
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) ds ON true
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND v_end;

  SELECT count(*)::integer
  INTO v_present
  FROM public.driver_attendance da
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND LEAST(v_end, v_today)
    AND da.status = 'present';

  RETURN jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'present_days', v_present,
    'elapsed_days', v_elapsed,
    'rows', v_rows
  );
END;
$$;
