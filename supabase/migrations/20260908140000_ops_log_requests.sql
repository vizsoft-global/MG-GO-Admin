-- Emit driver_operation_events from the RCM request RPCs. Signatures unchanged.
--
-- All four are Class A: they RETURN an error object instead of raising, so the
-- transaction commits and the plain in-transaction emitter is correct. No dblink
-- involved, which is why failures here are logged more generously than in the
-- delivery RPCs - an in-tx row costs nothing.
--
-- Still skipped: not_authenticated and not_a_driver. The first has no driver to
-- attribute to, and the second means the caller is not in drivers at all, so the
-- FK would drop the row anyway.

CREATE OR REPLACE FUNCTION public.driver_create_request(
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL::numeric,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_details text DEFAULT NULL::text,
  p_severity severity_level DEFAULT NULL::severity_level
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_error text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid AND d.archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  v_error := public.rcm_validate_request_input(
    p_type, p_payload, p_attachments, p_amount_kwd, p_start_date, p_end_date, p_details, p_severity);
  IF v_error IS NOT NULL THEN
    -- A rider who could not file a request is a support call waiting to happen.
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.create', 'rpc', 'driver_create_request',
      false, v_error, 'request', NULL,
      jsonb_build_object('request_type', p_type)
    );
    RETURN jsonb_build_object('ok', false, 'error', v_error);
  END IF;

  v_code := public.allocate_request_code();

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason
  ) VALUES (
    v_code, v_uid, p_type, 'submitted', COALESCE(p_payload, '{}'::jsonb),
    p_amount_kwd, p_start_date, p_end_date, p_details, p_severity,
    true, now(), 'new_request'
  )
  RETURNING id INTO v_id;

  PERFORM public.rcm_materialize_approval_steps(v_id);

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      INSERT INTO public.request_attachments (
        request_id, storage_key, file_name, content_type, byte_size, uploaded_by
      ) VALUES (
        v_id,
        v_att ->> 'storage_key',
        v_att ->> 'file_name',
        v_att ->> 'content_type',
        NULLIF(v_att ->> 'byte_size', '')::bigint,
        v_uid
      );
    END LOOP;
  END IF;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.create', 'rpc', 'driver_create_request',
    true, NULL, 'request', v_id,
    jsonb_build_object(
      'request_code', v_code,
      'request_type', p_type,
      'amount_kwd', p_amount_kwd,
      'attachment_count', COALESCE(jsonb_array_length(p_attachments), 0)
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_submit_clarification(
  p_request_id uuid,
  p_answer text,
  p_attachment_keys text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
  v_clar_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.requests
  WHERE id = p_request_id AND driver_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_req.status <> 'needs_clarification' THEN
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.clarify', 'rpc', 'driver_submit_clarification',
      false, 'wrong_status', 'request', p_request_id,
      jsonb_build_object('request_code', v_req.request_code, 'status', v_req.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
  END IF;

  IF p_answer IS NULL OR trim(p_answer) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'answer_required');
  END IF;

  UPDATE public.request_clarifications
  SET
    answered_at = now(),
    answer = trim(p_answer),
    answer_attachment_keys = COALESCE(p_attachment_keys, '{}')
  WHERE id = (
    SELECT id FROM public.request_clarifications
    WHERE request_id = p_request_id AND answered_at IS NULL
    ORDER BY asked_at DESC LIMIT 1
  )
  RETURNING id INTO v_clar_id;

  IF v_clar_id IS NULL THEN
    -- The app offered a clarification form for a request with nothing open.
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.clarify', 'rpc', 'driver_submit_clarification',
      false, 'no_open_clarification', 'request', p_request_id,
      jsonb_build_object('request_code', v_req.request_code)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'no_open_clarification');
  END IF;

  UPDATE public.requests
  SET
    status = 'in_review',
    needs_attention = true,
    attention_at = now(),
    attention_cleared_at = NULL,
    attention_reason = 'clarification_submitted',
    updated_at = now()
  WHERE id = p_request_id;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.clarify', 'rpc', 'driver_submit_clarification',
    true, NULL, 'request', p_request_id,
    jsonb_build_object(
      'request_code', v_req.request_code,
      'clarification_id', v_clar_id,
      'attachment_count', COALESCE(array_length(p_attachment_keys, 1), 0)
    )
  );

  RETURN jsonb_build_object('ok', true, 'clarification_id', v_clar_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_acknowledge_request(
  p_request_id uuid,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.requests%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid AND d.archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  SELECT * INTO v_row
  FROM public.requests r
  WHERE r.id = p_request_id
    AND r.driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status IN ('rejected', 'solved', 'responded', 'closed') THEN
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.acknowledge', 'rpc', 'driver_acknowledge_request',
      false, 'wrong_status', 'request', p_request_id,
      jsonb_build_object('request_code', v_row.request_code, 'status', v_row.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
  END IF;

  v_payload := COALESCE(v_row.payload, '{}'::jsonb)
    || jsonb_build_object(
      'driver_ack_at', now(),
      'driver_ack_note', NULLIF(trim(COALESCE(p_note, '')), ''),
      'awaiting_driver_ack', false
    );

  UPDATE public.requests
  SET
    payload = v_payload,
    acknowledged_at = now(),
    needs_attention = true,
    attention_at = now(),
    attention_reason = 'driver_ack',
    updated_at = now()
  WHERE id = p_request_id;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.acknowledge', 'rpc', 'driver_acknowledge_request',
    true, NULL, 'request', p_request_id,
    jsonb_build_object(
      'request_code', v_row.request_code,
      'request_type', v_row.request_type,
      'has_note', NULLIF(trim(COALESCE(p_note, '')), '') IS NOT NULL
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', p_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_respond_reschedule(
  p_request_id uuid,
  p_accept boolean,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
  v_proposed_start date;
  v_proposed_end date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.requests
  WHERE id = p_request_id AND driver_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_req.status <> 'rescheduled' THEN
    PERFORM public.log_driver_operation(
      v_uid, 'request', 'request.reschedule_respond', 'rpc', 'driver_respond_reschedule',
      false, 'wrong_status', 'request', p_request_id,
      jsonb_build_object('request_code', v_req.request_code, 'status', v_req.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
  END IF;

  v_proposed_start := NULLIF(v_req.payload #>> '{reschedule,proposed_start_date}', '')::date;
  v_proposed_end := NULLIF(v_req.payload #>> '{reschedule,proposed_end_date}', '')::date;

  UPDATE public.requests
  SET
    -- The approval step never moved, so the request goes back to where it was: under review
    -- by the same approver, who now knows the rider's answer.
    status = 'in_review',
    start_date = CASE WHEN p_accept THEN COALESCE(v_proposed_start, start_date) ELSE start_date END,
    end_date = CASE WHEN p_accept THEN COALESCE(v_proposed_end, end_date) ELSE end_date END,
    payload = COALESCE(payload, '{}'::jsonb)
      || jsonb_build_object('awaiting_driver_reschedule', false)
      || jsonb_build_object('reschedule',
           COALESCE(payload -> 'reschedule', '{}'::jsonb) || jsonb_build_object(
             'accepted', p_accept,
             'responded_at', now(),
             'driver_note', NULLIF(trim(COALESCE(p_note, '')), '')
           )),
    needs_attention = true,
    attention_at = now(),
    attention_reason = CASE WHEN p_accept THEN 'reschedule_accepted' ELSE 'reschedule_declined' END,
    updated_at = now()
  WHERE id = p_request_id;

  PERFORM public.log_driver_operation(
    v_uid, 'request', 'request.reschedule_respond', 'rpc', 'driver_respond_reschedule',
    true, NULL, 'request', p_request_id,
    jsonb_build_object(
      'request_code', v_req.request_code,
      'accepted', p_accept,
      'proposed_start_date', v_proposed_start,
      'proposed_end_date', v_proposed_end
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', p_request_id, 'accepted', p_accept);
END;
$function$;
