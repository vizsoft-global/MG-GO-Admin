-- Any approve on fuel / fuel_refund requires fuel_transfer_type (not only the final step).

CREATE OR REPLACE FUNCTION public.admin_decide_request(
  p_request_id uuid,
  p_action text,
  p_reason text DEFAULT NULL::text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_req public.requests%ROWTYPE;
  v_def public.request_type_definitions%ROWTYPE;
  v_step public.request_approval_steps%ROWTYPE;
  v_next public.request_approval_steps%ROWTYPE;
  v_next_sla_minutes int;
  v_next_sla timestamptz;
  v_next_breach text;
  v_action text := lower(trim(p_action));
  v_status text;
  v_title text;
  v_body text;
  v_link text;
  v_new_start date;
  v_new_end date;
  v_att jsonb;
  v_meta jsonb := COALESCE(p_meta, '{}'::jsonb);
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT (
    public.staff_has_permission('requests.approve')
    OR public.staff_has_permission('requests.manage')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_def FROM public.request_type_definitions WHERE key = v_req.request_type;

  SELECT NULLIF(trim(COALESCE(p.full_name, '')), '') INTO v_actor_name
  FROM public.profiles p WHERE p.id = v_uid;

  v_link := 'musallam:///profile/support/requests/' || p_request_id::text;

  IF v_action = 'close' THEN
    IF NOT public.staff_has_permission('requests.manage') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
    END IF;
    IF v_req.status = 'closed' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
    END IF;
    IF v_req.completed_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_decided_yet');
    END IF;
    UPDATE public.requests
    SET status = 'closed',
        closed_at = now(),
        closed_by = v_uid,
        needs_attention = false,
        updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'status', 'closed');
  END IF;

  IF v_req.status IN ('approved', 'rejected', 'solved', 'responded', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  IF v_req.status = 'rescheduled' AND v_action <> 'clarify' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver_reschedule');
  END IF;

  IF v_action = 'approve'
     AND v_req.request_type IN ('fuel', 'fuel_refund')
     AND v_req.fuel_transfer_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fuel_transfer_type_required');
  END IF;

  IF v_action = 'clarify' THEN
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
    END IF;
    INSERT INTO public.request_clarifications (request_id, step_order, asked_by, question)
    VALUES (p_request_id, v_req.current_step_order, v_uid, trim(p_reason));
    UPDATE public.requests
    SET status = 'needs_clarification',
        decision_reason = trim(p_reason),
        needs_attention = false,
        updated_at = now()
    WHERE id = p_request_id;
    UPDATE public.request_approval_steps
    SET actor_display_name = COALESCE(v_actor_name, actor_display_name), updated_at = now()
    WHERE request_id = p_request_id AND status = 'in_progress';
    v_status := 'needs_clarification';
    v_title := 'Action required — ' || v_req.request_code;
    v_body := 'Please respond to a clarification on your request.';
    v_link := 'musallam:///profile/support/action-required';
    PERFORM public.notify_driver_transactional(
      v_req.driver_id, v_title, v_body, v_link, 'operations', 'high',
      jsonb_build_object(
        'record_type', 'request',
        'record_id', p_request_id::text,
        'screen', 'support_action_required'
      )
    );
    RETURN jsonb_build_object('ok', true, 'status', v_status);
  END IF;

  IF v_action = 'reject' THEN
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
    END IF;
    UPDATE public.request_approval_steps
    SET status = 'rejected', decided_by = v_uid, decided_at = now(),
        actor_display_name = COALESCE(v_actor_name, actor_display_name),
        decision_note = trim(p_reason), updated_at = now()
    WHERE request_id = p_request_id AND status = 'in_progress';
    UPDATE public.requests
    SET status = 'rejected', decision_reason = trim(p_reason),
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        needs_attention = false, sla_due_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    PERFORM public.notify_driver_transactional(
      v_req.driver_id,
      'Request rejected — ' || v_req.request_code,
      COALESCE(NULLIF(trim(p_reason), ''), 'Your request was rejected.'),
      v_link, 'operations', 'high',
      jsonb_build_object('record_type', 'request', 'record_id', p_request_id::text)
    );
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF v_action = 'solve' THEN
    UPDATE public.requests
    SET status = 'solved', decided_by = v_uid, decided_at = now(),
        completed_at = now(), decision_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
        needs_attention = false, sla_due_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    PERFORM public.notify_driver_transactional(
      v_req.driver_id,
      'Request resolved — ' || v_req.request_code,
      'Your request has been marked resolved.',
      v_link, 'operations', 'normal',
      jsonb_build_object('record_type', 'request', 'record_id', p_request_id::text)
    );
    RETURN jsonb_build_object('ok', true, 'status', 'solved');
  END IF;

  IF v_action = 'reschedule' THEN
    v_new_start := NULLIF(v_meta ->> 'new_start_date', '')::date;
    v_new_end := NULLIF(v_meta ->> 'new_end_date', '')::date;
    IF v_new_start IS NULL AND v_new_end IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'reschedule_dates_required');
    END IF;
    IF v_new_start IS NOT NULL AND v_new_end IS NOT NULL AND v_new_end < v_new_start THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_date_range');
    END IF;

    SELECT * INTO v_step FROM public.request_approval_steps
    WHERE request_id = p_request_id AND status = 'in_progress'
    ORDER BY step_order LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_step');
    END IF;

    UPDATE public.request_approval_steps
    SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'reschedule_proposed_at', now(),
          'reschedule_proposed_by', COALESCE(v_actor_name, 'Admin'),
          'new_start_date', v_new_start,
          'new_end_date', v_new_end
        ),
        actor_display_name = COALESCE(v_actor_name, actor_display_name),
        updated_at = now()
    WHERE id = v_step.id;

    UPDATE public.requests
    SET status = 'rescheduled',
        decision_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'awaiting_driver_reschedule', true,
          'reschedule', jsonb_build_object(
            'proposed_start_date', v_new_start,
            'proposed_end_date', v_new_end,
            'proposed_by', COALESCE(v_actor_name, 'Admin'),
            'proposed_at', now(),
            'note', NULLIF(trim(COALESCE(p_reason, '')), '')
          )
        ),
        needs_attention = false,
        updated_at = now()
    WHERE id = p_request_id;

    PERFORM public.notify_driver_transactional(
      v_req.driver_id,
      'New dates proposed — ' || v_req.request_code,
      'Please accept or decline the proposed dates.',
      'musallam:///profile/support/action-required', 'operations', 'high',
      jsonb_build_object(
        'record_type', 'request',
        'record_id', p_request_id::text,
        'screen', 'support_action_required'
      )
    );
    RETURN jsonb_build_object('ok', true, 'status', 'rescheduled');
  END IF;

  IF v_action = 'send_response' THEN
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'response_required');
    END IF;

    UPDATE public.request_approval_steps
    SET status = 'completed', decided_by = v_uid, decided_at = now(),
        actor_display_name = COALESCE(v_actor_name, actor_display_name),
        decision_note = trim(p_reason),
        meta = COALESCE(meta, '{}'::jsonb) || v_meta,
        updated_at = now()
    WHERE request_id = p_request_id AND status = 'in_progress';

    UPDATE public.request_approval_steps
    SET status = 'skipped', updated_at = now()
    WHERE request_id = p_request_id AND status = 'pending';

    UPDATE public.requests
    SET status = 'responded',
        decision_reason = trim(p_reason),
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        needs_attention = false, sla_due_at = NULL, updated_at = now()
    WHERE id = p_request_id;

    PERFORM public.notify_driver_transactional(
      v_req.driver_id,
      'Response sent — ' || v_req.request_code,
      trim(p_reason),
      v_link, 'operations', 'high',
      jsonb_build_object('record_type', 'request', 'record_id', p_request_id::text)
    );
    RETURN jsonb_build_object('ok', true, 'status', 'responded');
  END IF;

  IF v_action IN ('approve', 'request_documents', 'escalate',
                  'attach_send', 'attach_breakdown') THEN
    IF v_action IN ('attach_send', 'attach_breakdown') THEN
      IF jsonb_typeof(v_meta -> 'attachments') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_meta -> 'attachments') < 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'attachment_required');
      END IF;
      FOR v_att IN SELECT * FROM jsonb_array_elements(v_meta -> 'attachments')
      LOOP
        IF NULLIF(trim(COALESCE(v_att ->> 'storage_key', '')), '') IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', 'attachment_required');
        END IF;
        INSERT INTO public.request_attachments (
          request_id, storage_key, file_name, content_type, byte_size, uploaded_by
        ) VALUES (
          p_request_id,
          v_att ->> 'storage_key',
          v_att ->> 'file_name',
          v_att ->> 'content_type',
          NULLIF(v_att ->> 'byte_size', '')::bigint,
          v_uid
        );
      END LOOP;
      v_meta := v_meta - 'attachments';
    END IF;

    SELECT * INTO v_step FROM public.request_approval_steps
    WHERE request_id = p_request_id AND status = 'in_progress'
    ORDER BY step_order LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_step');
    END IF;

    UPDATE public.request_approval_steps
    SET status = 'completed', decided_by = v_uid, decided_at = now(),
        actor_display_name = COALESCE(v_actor_name, actor_display_name),
        decision_note = NULLIF(trim(COALESCE(p_reason, '')), ''),
        meta = v_meta, updated_at = now()
    WHERE id = v_step.id;

    SELECT * INTO v_next FROM public.request_approval_steps
    WHERE request_id = p_request_id AND step_order > v_step.step_order
      AND status = 'pending'
    ORDER BY step_order LIMIT 1;

    IF FOUND THEN
      SELECT t.sla_minutes, t.breach_action INTO v_next_sla_minutes, v_next_breach
      FROM public.request_approval_step_templates t
      WHERE t.request_type = v_req.request_type AND t.step_order = v_next.step_order;

      v_next_sla := CASE
        WHEN v_next_sla_minutes IS NOT NULL
        THEN now() + make_interval(mins => v_next_sla_minutes)
      END;

      UPDATE public.request_approval_steps
      SET status = 'in_progress', started_at = now(),
          sla_due_at = v_next_sla, breach_action = v_next_breach, updated_at = now()
      WHERE id = v_next.id;

      UPDATE public.requests
      SET status = 'in_review',
          current_step_order = v_next.step_order,
          current_step_label = v_next.step_name,
          sla_due_at = v_next_sla,
          sla_breach_action = v_next_breach,
          updated_at = now()
      WHERE id = p_request_id;

      PERFORM public.notify_driver_transactional(
        v_req.driver_id,
        'Request update — ' || v_req.request_code,
        'Now at step: ' || v_next.step_name,
        v_link, 'operations', 'normal',
        jsonb_build_object('record_type', 'request', 'record_id', p_request_id::text)
      );
      RETURN jsonb_build_object('ok', true, 'status', 'in_review', 'step', v_next.step_order);
    END IF;

    v_status := COALESCE(v_def.terminal_status_on_approve, 'approved');

    UPDATE public.requests
    SET status = v_status::public.request_status,
        current_step_label = v_step.step_name,
        current_step_order = v_step.step_order,
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        payload = CASE
          WHEN v_status = 'approved'
               AND COALESCE(v_def.requires_driver_ack_on_approve, false)
          THEN COALESCE(payload, '{}'::jsonb)
               || jsonb_build_object('awaiting_driver_ack', true)
          ELSE payload
        END,
        needs_attention = false, sla_due_at = NULL, updated_at = now()
    WHERE id = p_request_id;

    PERFORM public.notify_driver_transactional(
      v_req.driver_id,
      CASE WHEN v_status = 'solved'
           THEN 'Request resolved — ' || v_req.request_code
           ELSE 'Request approved — ' || v_req.request_code END,
      CASE WHEN v_status = 'solved'
           THEN 'Your request has been resolved.'
           ELSE 'Your request has been approved.' END,
      v_link, 'operations', 'high',
      jsonb_build_object('record_type', 'request', 'record_id', p_request_id::text)
    );

    RETURN jsonb_build_object('ok', true, 'status', v_status);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;
