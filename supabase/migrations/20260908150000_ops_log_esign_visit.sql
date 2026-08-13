-- Emit driver_operation_events from the e-sign, visit and appointment RPCs.
-- Signatures unchanged. All Class A, so plain in-transaction emits.
--
-- driver_mark_esign_viewed logs only the FIRST view. The RPC is idempotent and
-- the app can call it on every open, so logging unconditionally would claim the
-- rider opened the document many times when the record only means "has seen it".

CREATE OR REPLACE FUNCTION public.driver_mark_esign_viewed(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_viewed timestamptz;
  v_was_viewed timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT viewed_at INTO v_was_viewed
  FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid;

  UPDATE public.esign_requests
  SET viewed_at = COALESCE(viewed_at, now()),
      updated_at = CASE WHEN viewed_at IS NULL THEN now() ELSE updated_at END
  WHERE id = p_id
    AND driver_id = v_uid
  RETURNING viewed_at INTO v_viewed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_was_viewed IS NULL THEN
    PERFORM public.log_driver_operation(
      v_uid, 'esign', 'esign.viewed', 'rpc', 'driver_mark_esign_viewed',
      true, NULL, 'esign_request', p_id, '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'viewed_at', v_viewed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_submit_esignature(
  p_id uuid,
  p_signature_storage_key text,
  p_signer_display_name text DEFAULT NULL::text,
  p_signer_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
  v_meta jsonb := COALESCE(p_signer_meta, '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_signature_storage_key IS NULL OR trim(p_signature_storage_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_required');
  END IF;
  -- The acceptance itself can only ever come from the device; what the server
  -- guarantees is that a signature is never stored without it, and that the
  -- moment of acceptance is server time.
  IF COALESCE((v_meta->>'declaration_accepted')::boolean, false) IS NOT TRUE THEN
    -- A signature offered without the declaration is worth a record: it is the
    -- one failure here with legal weight.
    PERFORM public.log_driver_operation(
      v_uid, 'esign', 'esign.sign', 'rpc', 'driver_submit_esignature',
      false, 'declaration_required', 'esign_request', p_id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'declaration_required');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    PERFORM public.log_driver_operation(
      v_uid, 'esign', 'esign.sign', 'rpc', 'driver_submit_esignature',
      false, 'not_pending', 'esign_request', p_id,
      jsonb_build_object('request_code', v_req.request_code, 'status', v_req.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'signed',
      signed_at = now(),
      declaration_accepted_at = now(),
      -- Signing is also a view, for a request whose open was never recorded
      -- (older app builds, or a deep link straight into capture).
      viewed_at = COALESCE(viewed_at, now()),
      signature_storage_key = trim(p_signature_storage_key),
      signer_display_name = NULLIF(trim(COALESCE(p_signer_display_name, '')), ''),
      signer_meta = v_meta || jsonb_build_object('declaration_accepted', true),
      updated_at = now()
  WHERE id = p_id;

  PERFORM public.log_driver_operation(
    v_uid, 'esign', 'esign.sign', 'rpc', 'driver_submit_esignature',
    true, NULL, 'esign_request', p_id,
    jsonb_build_object(
      'request_code', v_req.request_code,
      'first_view_was_capture', v_req.viewed_at IS NULL
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'signed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_decline_esignature(
  p_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.esign_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.esign_requests
  WHERE id = p_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    PERFORM public.log_driver_operation(
      v_uid, 'esign', 'esign.decline', 'rpc', 'driver_decline_esignature',
      false, 'not_pending', 'esign_request', p_id,
      jsonb_build_object('request_code', v_req.request_code, 'status', v_req.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.esign_requests
  SET status = 'declined',
      declined_at = now(),
      -- Declining is also a view; a rider cannot refuse a document sight unseen.
      viewed_at = COALESCE(viewed_at, now()),
      signer_meta = COALESCE(signer_meta, '{}'::jsonb) || jsonb_build_object(
        'declined_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
      ),
      updated_at = now()
  WHERE id = p_id;

  PERFORM public.log_driver_operation(
    v_uid, 'esign', 'esign.decline', 'rpc', 'driver_decline_esignature',
    true, NULL, 'esign_request', p_id,
    jsonb_build_object(
      'request_code', v_req.request_code,
      'declined_reason', NULLIF(trim(COALESCE(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'declined');
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.driver_cancel_visit(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.visit_bookings
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = p_booking_id
    AND driver_id = v_uid
    AND status = 'confirmed'
  RETURNING booking_code INTO v_code;

  IF NOT FOUND THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'visit.cancel', 'rpc', 'driver_cancel_visit',
      false, 'not_cancellable', 'visit_booking', p_booking_id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'visit', 'visit.cancel', 'rpc', 'driver_cancel_visit',
    true, NULL, 'visit_booking', p_booking_id,
    jsonb_build_object('booking_code', v_code)
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_respond_appointment(
  p_id uuid,
  p_action text,
  p_proposed_for timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.appointments%ROWTYPE;
  v_action text := lower(trim(p_action));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_row FROM public.appointments
  WHERE id = p_id AND driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status NOT IN ('pending', 'scheduled') THEN
    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'appointment.respond', 'rpc', 'driver_respond_appointment',
      false, 'not_pending', 'appointment', p_id,
      jsonb_build_object(
        'appointment_code', v_row.appointment_code,
        'status', v_row.status::text,
        'action', v_action
      )
    );
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  IF v_action = 'accept' THEN
    UPDATE public.appointments
    SET status = 'accepted', responded_at = now(), updated_at = now()
    WHERE id = p_id;

    PERFORM public.notify_driver_transactional(
      v_uid,
      'Appointment confirmed — ' || COALESCE(v_row.appointment_code, ''),
      COALESCE(v_row.title, 'Appointment') || ' at ' || COALESCE(v_row.location_label, 'Central Tower'),
      'musallam:///profile/support/appointments/' || p_id::text || '/confirmed',
      'operations', 'normal',
      jsonb_build_object('record_type', 'appointment', 'record_id', p_id::text)
    );

    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'appointment.accept', 'rpc', 'driver_respond_appointment',
      true, NULL, 'appointment', p_id,
      jsonb_build_object('appointment_code', v_row.appointment_code)
    );

    RETURN jsonb_build_object('ok', true, 'status', 'accepted');
  END IF;

  IF v_action = 'reject' THEN
    UPDATE public.appointments
    SET status = 'rejected',
        driver_response_note = NULLIF(trim(COALESCE(p_note, '')), ''),
        responded_at = now(), updated_at = now()
    WHERE id = p_id;

    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'appointment.reject', 'rpc', 'driver_respond_appointment',
      true, NULL, 'appointment', p_id,
      jsonb_build_object(
        'appointment_code', v_row.appointment_code,
        'note', NULLIF(trim(COALESCE(p_note, '')), '')
      )
    );

    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF v_action = 'propose' THEN
    IF p_proposed_for IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'proposed_time_required');
    END IF;
    UPDATE public.appointments
    SET status = 'reschedule_requested',
        proposed_for = p_proposed_for,
        driver_response_note = NULLIF(trim(COALESCE(p_note, '')), ''),
        responded_at = now(), updated_at = now()
    WHERE id = p_id;

    PERFORM public.log_driver_operation(
      v_uid, 'visit', 'appointment.reschedule_request', 'rpc', 'driver_respond_appointment',
      true, NULL, 'appointment', p_id,
      jsonb_build_object(
        'appointment_code', v_row.appointment_code,
        'proposed_for', p_proposed_for
      )
    );

    RETURN jsonb_build_object('ok', true, 'status', 'reschedule_requested');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;
