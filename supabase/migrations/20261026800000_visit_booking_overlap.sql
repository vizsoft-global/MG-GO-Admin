-- Same rider + same date + overlapping slot clock window is refused across
-- departments. Per-dept-per-day unique (visit_bookings_active_driver_date_dept_uidx)
-- is unchanged. Existing overlap rows are not rewritten.

CREATE OR REPLACE FUNCTION public.driver_book_visit(
  p_department_key text,
  p_date date,
  p_slot_id uuid,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot public.visit_slots%ROWTYPE;
  v_dept public.visit_departments%ROWTYPE;
  v_booked int;
  v_code text;
  v_id uuid;
  v_branch uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_uid AND archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  SELECT * INTO v_dept FROM public.visit_departments
  WHERE key = p_department_key AND is_active;
  IF NOT FOUND THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'invalid_department', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'date', p_date)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_department');
  END IF;

  SELECT * INTO v_slot FROM public.visit_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_active THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'slot_not_found', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'slot_id', p_slot_id)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  IF v_dept.branch_id IS NOT NULL AND v_dept.branch_id IS DISTINCT FROM v_slot.branch_id THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'department_not_at_branch', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'slot_id', p_slot_id)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'department_not_at_branch');
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.visit_bookings
  WHERE slot_id = p_slot_id
    AND scheduled_date = p_date
    AND status IN ('confirmed', 'checked_in');

  IF v_booked >= v_slot.capacity THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'slot_full', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'capacity', v_slot.capacity
      )
    );
    RETURN jsonb_build_object('ok', false, 'error', 'slot_full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit_bookings
    WHERE driver_id = v_uid
      AND scheduled_date = p_date
      AND department_key = p_department_key
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'duplicate_department_date', 'visit_booking', NULL,
      jsonb_build_object('department_key', p_department_key, 'date', p_date)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.visit_bookings b
    JOIN public.visit_slots s ON s.id = b.slot_id
    WHERE b.driver_id = v_uid
      AND b.scheduled_date = p_date
      AND b.status IN ('confirmed', 'checked_in')
      AND s.start_time < v_slot.end_time
      AND s.end_time > v_slot.start_time
  ) THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'overlapping_visit', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'slot_id', p_slot_id
      )
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'overlapping_visit',
      'message', 'You already have a visit at this time. Pick another slot.'
    );
  END IF;

  SELECT id INTO v_branch FROM public.visit_branches
  WHERE is_active
  ORDER BY is_default DESC, sort_order
  LIMIT 1;

  v_code := public.allocate_visit_booking_code();

  BEGIN
    INSERT INTO public.visit_bookings (
      booking_code, driver_id, department_key, branch_id, slot_id,
      scheduled_date, note, status
    ) VALUES (
      v_code, v_uid, p_department_key,
      COALESCE(v_slot.branch_id, v_dept.branch_id, v_branch),
      p_slot_id, p_date, NULLIF(trim(COALESCE(p_note, '')), ''), 'confirmed'
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
      false, 'duplicate_department_date', 'visit_booking', NULL,
      jsonb_build_object(
        'department_key', p_department_key,
        'date', p_date,
        'source', 'unique_index'
      )
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END;

  PERFORM public.log_driver_operation(
    v_uid, 'visit', 'visit.book', 'rpc', 'driver_book_visit',
    true, NULL, 'visit_booking', v_id,
    jsonb_build_object(
      'booking_code', v_code,
      'department_key', p_department_key,
      'date', p_date
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'booking_code', v_code, 'status', 'confirmed'
  );
END;
$function$;
