-- Close the remaining failure-coverage gaps in the driver operation stream.
--
-- 20260908110000-20260908160000 logged every success and the failures that were
-- expensive to miss. The audit run for this change found a consistent shape to
-- what was left: validation that fires BEFORE the RPC touches a row. Those
-- checks raise immediately, so there was nothing to attach an in-transaction row
-- to, and at the time the autonomous emitter was still inert. It works now
-- (20260909100100), so they are logged the same way the later failures are.
--
-- What this means in practice: a driver repeatedly failing to log a pickup
-- because the GPS fix never arrives (location_required), or fighting the shift
-- form (sessions_overlap, future_date), used to leave no trace at all. Support
-- saw an empty timeline and had to take the driver's word for it. Now the
-- attempt is on the record with its arguments.
--
-- Error messages and SQLSTATEs are unchanged. driver_ops_fail raises with the
-- code as the message exactly as the inline RAISE did, and PostgREST surfaces
-- message/detail/hint/code - none of which move - so no driver app build can
-- tell the difference.

-- ---------------------------------------------------------------------------
-- Raise-and-log helper
-- ---------------------------------------------------------------------------

-- Fifteen call sites would otherwise repeat a five-line PERFORM + RAISE pair,
-- which is how the pair drifts apart. Kept VOLATILE and never called anywhere
-- that is not already about to abort.
CREATE OR REPLACE FUNCTION public.driver_ops_fail(
  p_driver_id     uuid,
  p_category      text,
  p_operation_key text,
  p_source_name   text,
  p_error_code    text,
  p_context       jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.log_driver_operation_autonomous(
    p_driver_id, p_category, p_operation_key, p_source_name, p_error_code, p_context
  );
  -- '%' with the code as the sole argument reproduces `RAISE EXCEPTION '<code>'`
  -- byte for byte: same message, same P0001, no DETAIL or HINT added.
  RAISE EXCEPTION '%', p_error_code;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_ops_fail(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.driver_ops_fail(uuid, text, text, text, text, jsonb) IS
  'Records a business validation failure over the autonomous audit path and then raises the original error code unchanged.';

-- ---------------------------------------------------------------------------
-- Duty: shift submission validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_submit_daily_shift(
  p_shift_type text,
  p_session1_start time without time zone,
  p_session1_end time without time zone,
  p_session2_start time without time zone DEFAULT NULL::time without time zone,
  p_session2_end time without time zone DEFAULT NULL::time without time zone,
  p_shift_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_shift_date date := COALESCE(p_shift_date, v_today);
  v_existing public.driver_daily_shifts;
  v_s1_end_offset smallint;
  v_s2_start_offset smallint := 0;
  v_s2_end_offset smallint := 0;
  v_s1_start timestamptz;
  v_s1_end timestamptz;
  v_s2_start timestamptz;
  v_s2_end timestamptz;
  v_shift_end timestamptz;
  v_row public.driver_daily_shifts;
  v_offset_try integer;
  v_args jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Every failure below carries what the driver actually submitted, because the
  -- useful question after the fact is which field was wrong, not that one was.
  v_args := jsonb_build_object(
    'shift_date', v_shift_date,
    'shift_type', p_shift_type,
    'session1_start', p_session1_start,
    'session1_end', p_session1_end,
    'session2_start', p_session2_start,
    'session2_end', p_session2_end
  );

  IF p_shift_type NOT IN ('single', 'split') THEN
    PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'invalid_shift_type', v_args);
  END IF;

  IF v_shift_date > v_today THEN
    PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'future_date', v_args);
  END IF;

  IF p_session1_start IS NULL OR p_session1_end IS NULL THEN
    PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'session1_required', v_args);
  END IF;

  v_s1_end_offset := public._shift_end_day_offset(p_session1_start, p_session1_end, NULL);
  v_s1_start := public.shift_session_instant(v_shift_date, p_session1_start, 0);
  v_s1_end := public.shift_session_instant(v_shift_date, p_session1_end, v_s1_end_offset);

  IF v_s1_end <= v_s1_start THEN
    PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'invalid_session1_duration', v_args);
  END IF;

  IF extract(epoch FROM (v_s1_end - v_s1_start)) > 86400 THEN
    PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'session_too_long', v_args || jsonb_build_object('session', 1));
  END IF;

  IF p_shift_type = 'split' THEN
    IF p_session2_start IS NULL OR p_session2_end IS NULL THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'session2_required', v_args);
    END IF;

    IF v_s1_end_offset = 0 AND p_session2_start < p_session1_end THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'sessions_overlap', v_args || jsonb_build_object('check', 'clock_order'));
    END IF;

    -- Session 2 must start at or after session 1 ends (try day offsets 0..2).
    FOR v_offset_try IN 0..2 LOOP
      v_s2_start_offset := v_offset_try::smallint;
      v_s2_start := public.shift_session_instant(
        v_shift_date,
        p_session2_start,
        v_s2_start_offset
      );
      EXIT WHEN v_s2_start >= v_s1_end;
    END LOOP;

    IF v_s2_start < v_s1_end THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'sessions_overlap', v_args || jsonb_build_object('check', 'day_offset_exhausted'));
    END IF;

    IF p_session2_end <= p_session2_start THEN
      v_s2_end_offset := v_s2_start_offset + 1;
    ELSE
      v_s2_end_offset := v_s2_start_offset;
    END IF;

    v_s2_end := public.shift_session_instant(
      v_shift_date,
      p_session2_end,
      v_s2_end_offset
    );

    IF v_s2_end <= v_s2_start THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'invalid_session2_duration', v_args);
    END IF;

    IF extract(epoch FROM (v_s2_end - v_s2_start)) > 86400 THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'session_too_long', v_args || jsonb_build_object('session', 2));
    END IF;

    v_shift_end := GREATEST(v_s1_end, v_s2_end);
  ELSE
    IF p_session2_start IS NOT NULL OR p_session2_end IS NOT NULL THEN
      PERFORM public.driver_ops_fail(v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'session2_not_allowed', v_args);
    END IF;
    v_shift_end := v_s1_end;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.driver_daily_shifts ds
  WHERE ds.driver_id = v_uid
    AND ds.shift_date = v_shift_date;

  IF FOUND THEN
    IF v_existing.shift_type = 'split' THEN
      v_shift_end := GREATEST(
        public.shift_session_instant(v_existing.shift_date, v_existing.session1_end, v_existing.session1_end_day_offset),
        public.shift_session_instant(v_existing.shift_date, v_existing.session2_end, v_existing.session2_end_day_offset)
      );
    ELSE
      v_shift_end := public.shift_session_instant(
        v_existing.shift_date,
        v_existing.session1_end,
        v_existing.session1_end_day_offset
      );
    END IF;

    IF now() < v_shift_end THEN
      -- Autonomous: a driver trying to rewrite a shift that is still running is
      -- worth seeing, and the RAISE below would discard an in-tx row.
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'duty', 'shift.submit', 'driver_submit_daily_shift', 'shift_locked',
        jsonb_build_object(
          'shift_date', v_shift_date,
          'requested_shift_type', p_shift_type,
          'locked_until', v_shift_end
        )
      );
      RAISE EXCEPTION 'shift_locked';
    END IF;
  END IF;

  INSERT INTO public.driver_daily_shifts (
    driver_id,
    shift_date,
    shift_type,
    session1_start,
    session1_end,
    session1_end_day_offset,
    session2_start,
    session2_end,
    session2_start_day_offset,
    session2_end_day_offset,
    submitted_at,
    updated_at
  )
  VALUES (
    v_uid,
    v_shift_date,
    p_shift_type,
    p_session1_start,
    p_session1_end,
    v_s1_end_offset,
    CASE WHEN p_shift_type = 'split' THEN p_session2_start ELSE NULL END,
    CASE WHEN p_shift_type = 'split' THEN p_session2_end ELSE NULL END,
    CASE WHEN p_shift_type = 'split' THEN v_s2_start_offset ELSE 0 END,
    CASE WHEN p_shift_type = 'split' THEN v_s2_end_offset ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (driver_id, shift_date) DO UPDATE SET
    shift_type = EXCLUDED.shift_type,
    session1_start = EXCLUDED.session1_start,
    session1_end = EXCLUDED.session1_end,
    session1_end_day_offset = EXCLUDED.session1_end_day_offset,
    session2_start = EXCLUDED.session2_start,
    session2_end = EXCLUDED.session2_end,
    session2_start_day_offset = EXCLUDED.session2_start_day_offset,
    session2_end_day_offset = EXCLUDED.session2_end_day_offset,
    submitted_at = EXCLUDED.submitted_at,
    updated_at = now()
  RETURNING * INTO v_row;

  PERFORM public.log_driver_operation(
    v_uid, 'duty', 'shift.submit', 'rpc', 'driver_submit_daily_shift',
    true, NULL, 'daily_shift', v_row.id,
    jsonb_build_object(
      'shift_date', v_row.shift_date,
      'shift_type', v_row.shift_type,
      'resubmitted', v_existing.id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'shift', public._shift_row_to_json(v_row)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Delivery: pre-row validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_create_pickup(
  p_external_order_id text DEFAULT NULL::text,
  p_order_proof_url text DEFAULT NULL::text,
  p_pickup_lat numeric DEFAULT NULL::numeric,
  p_pickup_lng numeric DEFAULT NULL::numeric,
  p_device_id text DEFAULT NULL::text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_row public.deliveries%ROWTYPE;
  v_norm text;
  v_order_id text;
  v_proximity integer;
  v_active uuid;
  v_restaurant_id uuid;
  v_matched_count integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_dup boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_driver := public._driver_assert_active_on_duty(v_uid);
  PERFORM public._driver_assert_device_match(v_uid, p_device_id);

  SELECT d.id INTO v_active
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status = 'in_transit'::public.delivery_status
  LIMIT 1;

  IF v_active IS NOT NULL THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'active_pickup_exists',
      jsonb_build_object('blocking_delivery_id', v_active, 'order_id_tried', p_external_order_id)
    );
    RAISE EXCEPTION 'active_pickup_exists';
  END IF;

  -- assert_external_order_id raises from inside a helper, so a driver typing a
  -- malformed Order ID produced no record at all and support had nothing to
  -- compare against the partner app. Re-raising SQLERRM keeps the code the app
  -- already matches on (invalid_order_id) and survives that helper gaining a
  -- second code later.
  BEGIN
    v_order_id := public.assert_external_order_id(p_external_order_id);
  EXCEPTION WHEN others THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      SQLERRM,
      jsonb_build_object('order_id_tried', p_external_order_id)
    );
  END;

  v_norm := public.normalize_external_order_id(v_order_id);

  -- A pickup with no fix is the single most common way a delivery goes
  -- unrecorded, and it looked identical to the driver never trying.
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'location_required',
      jsonb_build_object('order_id_tried', p_external_order_id)
    );
  END IF;

  SELECT COALESCE(driver_app_delivery_proximity_meters, 500)
  INTO v_proximity
  FROM public.app_settings
  WHERE id = 1;

  IF v_proximity > 0
     AND NOT public.driver_is_within_delivery_range(
       v_uid,
       p_pickup_lat::double precision,
       p_pickup_lng::double precision,
       v_proximity
     ) THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
      'delivery_out_of_range',
      jsonb_build_object(
        'order_id_tried', p_external_order_id,
        'proximity_meters', v_proximity,
        'lat', p_pickup_lat,
        'lng', p_pickup_lng
      )
    );
    RAISE EXCEPTION 'delivery_out_of_range';
  END IF;

  v_restaurant_id := NULL;

  IF v_driver.partner_id IS NOT NULL THEN
    SELECT
      COUNT(*)::integer,
      (array_agg(dr.restaurant_id))[1]
    INTO v_matched_count, v_restaurant_id
    FROM public.driver_restaurants dr
    INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id = v_uid
      AND r.partner_id = v_driver.partner_id
      AND r.status = 'published'
      AND r.is_active = true;

    IF v_matched_count IS DISTINCT FROM 1 THEN
      v_restaurant_id := NULL;
    END IF;
  END IF;

  IF v_norm IS NOT NULL
     AND v_norm <> ''
     AND v_restaurant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.deliveries d
      WHERE d.restaurant_id = v_restaurant_id
        AND d.status <> 'cancelled'::public.delivery_status
        AND public.normalize_external_order_id(d.external_order_id) = v_norm
        AND (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date = v_today
    ) INTO v_dup;

    IF v_dup THEN
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
        'duplicate_order_id',
        jsonb_build_object('order_id_tried', v_order_id, 'restaurant_id', v_restaurant_id)
      );
      RAISE EXCEPTION 'duplicate_order_id';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.deliveries (
      driver_id,
      partner_id,
      zone_id,
      restaurant_id,
      external_order_id,
      pickup_proof_url,
      status,
      pickup_at,
      pickup_lat,
      pickup_lng
    ) VALUES (
      v_uid,
      v_driver.partner_id,
      v_driver.zone_id,
      v_restaurant_id,
      v_order_id,
      NULLIF(trim(p_order_proof_url), ''),
      'in_transit'::public.delivery_status,
      now(),
      p_pickup_lat,
      p_pickup_lng
    )
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.log_driver_operation_autonomous(
        v_uid, 'delivery', 'delivery.pickup_create', 'driver_create_pickup',
        'duplicate_order_id',
        jsonb_build_object('order_id_tried', v_order_id, 'source', 'unique_index')
      );
      RAISE EXCEPTION 'duplicate_order_id';
  END;

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.pickup_create', 'rpc', 'driver_create_pickup',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'restaurant_id', v_row.restaurant_id,
      'partner_id', v_row.partner_id
    ),
    p_pickup_lat, p_pickup_lng
  );

  RETURN v_row;
END;
$function$;

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
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'delivery_id_required', '{}'::jsonb
    );
  END IF;

  -- Worth recording: the driver reached the customer and the app could not prove
  -- where. Without this the delivery just stays in_transit with no explanation.
  IF p_delivered_lat IS NULL OR p_delivered_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'location_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'delivery_not_found',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    RETURN v_row;
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.complete', 'driver_complete_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
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

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.complete', 'rpc', 'driver_complete_delivery',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'restaurant_id', v_row.restaurant_id
    ),
    p_delivered_lat, p_delivered_lng
  );

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
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'delivery_id_required', '{}'::jsonb
    );
  END IF;

  v_reason := NULLIF(trim(p_cancel_reason), '');
  IF v_reason IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'cancel_reason_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END IF;

  IF p_cancel_lat IS NULL OR p_cancel_lng IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'location_required',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
  END IF;

  SELECT * INTO v_row
  FROM public.deliveries d
  WHERE d.id = p_delivery_id
    AND d.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'delivery_not_found',
      jsonb_build_object('delivery_id', p_delivery_id)
    );
    RAISE EXCEPTION 'delivery_not_found';
  END IF;

  IF v_row.status = 'cancelled'::public.delivery_status THEN
    RETURN v_row;
  END IF;

  IF v_row.status IN ('pending'::public.delivery_status, 'verified'::public.delivery_status) THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;

  IF v_row.status IS DISTINCT FROM 'in_transit'::public.delivery_status THEN
    PERFORM public.log_driver_operation_autonomous(
      v_uid, 'delivery', 'delivery.cancel', 'driver_cancel_delivery',
      'invalid_delivery_status',
      jsonb_build_object('delivery_id', p_delivery_id, 'status', v_row.status::text)
    );
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

  PERFORM public.log_driver_operation(
    v_uid, 'delivery', 'delivery.cancel', 'rpc', 'driver_cancel_delivery',
    true, NULL, 'delivery', v_row.id,
    jsonb_build_object(
      'order_id', v_row.external_order_id,
      'cancel_reason', v_reason
    ),
    p_cancel_lat, p_cancel_lng
  );

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Auth: login selfie key validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_record_login_verification(
  p_object_key text,
  p_liveness_passed boolean DEFAULT false,
  p_liveness_method text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_object_key, '')), '');
  v_row public.driver_login_verifications%ROWTYPE;
  v_expected_prefix text;
  v_passed boolean := COALESCE(p_liveness_passed, false);
  v_method text := NULLIF(btrim(COALESCE(p_liveness_method, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid) THEN
    RAISE EXCEPTION 'not_a_driver';
  END IF;

  -- A login selfie that never lands means the driver started a shift without the
  -- identity check the compliance story depends on, so the attempt is recorded.
  IF v_key IS NULL THEN
    PERFORM public.driver_ops_fail(
      v_uid, 'auth', 'auth.login_selfie', 'driver_record_login_verification',
      'object_key_required', '{}'::jsonb
    );
  END IF;

  v_expected_prefix := 'drivers/' || v_uid::text || '/login_verification/';
  IF position(v_expected_prefix in v_key) <> 1 THEN
    -- A key pointing outside the caller own prefix is an integrity signal, not a
    -- typo: the stored key is what the selfie is later retrieved by.
    PERFORM public.driver_ops_fail(
      v_uid, 'auth', 'auth.login_selfie', 'driver_record_login_verification',
      'invalid_object_key',
      jsonb_build_object('object_key', v_key)
    );
  END IF;

  -- Phase 1: accept DEFAULT false / omitted args from old APKs. No hard RAISE.

  INSERT INTO public.driver_login_verifications (
    driver_id,
    object_key,
    captured_at,
    liveness_passed,
    liveness_method
  )
  VALUES (v_uid, v_key, now(), v_passed, v_method)
  RETURNING * INTO v_row;

  PERFORM public.log_driver_operation(
    v_uid, 'auth', 'auth.login_selfie', 'rpc', 'driver_record_login_verification',
    true, NULL, 'login_verification', v_row.id,
    jsonb_build_object('liveness_passed', v_passed, 'liveness_method', v_method)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'object_key', v_row.object_key,
    'captured_at', v_row.captured_at,
    'created_at', v_row.created_at,
    'liveness_passed', v_row.liveness_passed,
    'liveness_method', v_row.liveness_method
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Auth: profile bootstrap
-- ---------------------------------------------------------------------------

-- The first thing a new rider ever does, and until now the only driver-facing
-- RPC that wrote to drivers without leaving a trace. The Activity tab therefore
-- began mid-story, with no record of the account being created or of an intake
-- being matched by phone - which is the step support is asked about when a
-- driver ends up with the wrong driver code.
CREATE OR REPLACE FUNCTION public.register_or_sync_rider_profile(p_full_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_role public.app_role;
  v_driver_code text;
  v_phone text;
  v_intake record;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_phone := nullif(btrim(coalesce(auth.jwt() ->> 'phone', '')), '');

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  IF v_role = 'staff'::public.app_role THEN
    -- Deliberately not logged: driver_operation_events.driver_id references
    -- drivers, and a staff account has no row there, so the event has nothing to
    -- hang off. Staff activity is already covered by admin_activity_logs.
    RETURN jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  END IF;

  IF v_role IS NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, locale, phone)
    VALUES (
      v_uid,
      nullif(v_email, ''),
      nullif(trim(p_full_name), ''),
      'rider'::public.app_role,
      'en',
      v_phone
    );
  ELSE
    UPDATE public.profiles
    SET
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      email = coalesce(nullif(v_email, ''), email),
      phone = coalesce(v_phone, phone),
      updated_at = now()
    WHERE id = v_uid AND role = 'rider'::public.app_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_uid) THEN
    IF v_phone IS NOT NULL THEN
      SELECT id, driver_code, linked_profile_id, archived_at
      INTO v_intake
      FROM public.driver_intakes
      WHERE phone = v_phone
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_intake.id IS NOT NULL AND v_intake.archived_at IS NULL THEN
      v_driver_code := v_intake.driver_code;
    ELSE
      v_driver_code := public.allocate_driver_code();
    END IF;

    INSERT INTO public.drivers (id, driver_code, status, is_on_duty)
    VALUES (v_uid, v_driver_code, 'pending'::public.driver_status, false);

    v_created := true;
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'profile', 'profile.register_sync', 'rpc', 'register_or_sync_rider_profile',
    true, NULL, 'driver', v_uid,
    jsonb_build_object(
      'driver_created', v_created,
      'profile_created', v_role IS NULL,
      'matched_intake_id', v_intake.id,
      'driver_code', (SELECT driver_code FROM public.drivers WHERE id = v_uid)
    )
  );

  RETURN jsonb_build_object('ok', true, 'driver_code', (
    SELECT driver_code FROM public.drivers WHERE id = v_uid
  ));
END;
$function$;
