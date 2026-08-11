-- Transactional driver inbox rows for RCM / Visit status changes.
-- Creates campaign + run + dispatch_item (inbox). FCM may be sent from admin Node after.

CREATE OR REPLACE FUNCTION public.notify_driver_transactional(
  p_driver_id uuid,
  p_title text,
  p_body text,
  p_deep_link text DEFAULT NULL,
  p_category public.notification_category DEFAULT 'operations',
  p_priority public.notification_priority DEFAULT 'high',
  p_action_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_run_id uuid;
  v_item_id uuid;
  v_params jsonb := COALESCE(p_action_params, '{}'::jsonb);
BEGIN
  IF p_driver_id IS NULL OR p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  IF p_deep_link IS NOT NULL AND trim(p_deep_link) <> '' THEN
    v_params := v_params || jsonb_build_object('deep_link', trim(p_deep_link));
  END IF;

  INSERT INTO public.notification_campaigns (
    title, body, category, priority, status,
    action_type, action_params, payload_version,
    target_spec, recipient_count, delivered_count, sent_at, estimated_audience_count
  ) VALUES (
    trim(p_title),
    COALESCE(NULLIF(trim(p_body), ''), trim(p_title)),
    p_category,
    p_priority,
    'sent',
    'open_record',
    v_params,
    2,
    jsonb_build_object('mode', 'transactional', 'driver_ids', jsonb_build_array(p_driver_id)),
    1,
    1,
    now(),
    1
  )
  RETURNING id INTO v_campaign_id;

  INSERT INTO public.notification_dispatch_runs (
    campaign_id, status, provider, idempotency_key,
    started_at, finished_at, total_count, sent_count
  ) VALUES (
    v_campaign_id,
    'sent',
    'fcm',
    'txn-' || v_campaign_id::text,
    now(),
    now(),
    1,
    1
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.notification_dispatch_items (
    run_id, campaign_id, driver_id, status, delivered_at, sent_at
  ) VALUES (
    v_run_id, v_campaign_id, p_driver_id, 'delivered', now(), now()
  )
  RETURNING id INTO v_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', v_campaign_id,
    'dispatch_item_id', v_item_id,
    'deep_link', p_deep_link
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_driver_transactional(
  uuid, text, text, text, public.notification_category, public.notification_priority, jsonb
) TO authenticated, service_role;

-- Patch admin_decide_request to notify the rider (no admin push).
CREATE OR REPLACE FUNCTION public.admin_decide_request(
  p_request_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
  v_step public.request_approval_steps%ROWTYPE;
  v_next public.request_approval_steps%ROWTYPE;
  v_action text := lower(trim(p_action));
  v_status text;
  v_title text;
  v_body text;
  v_link text;
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

  IF v_req.status IN ('approved', 'rejected', 'solved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  v_link := 'musallam:///profile/support/requests/' || p_request_id::text;

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
        decision_note = trim(p_reason), updated_at = now()
    WHERE request_id = p_request_id AND status = 'in_progress';
    UPDATE public.requests
    SET status = 'rejected', decision_reason = trim(p_reason),
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        needs_attention = false, updated_at = now()
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
        needs_attention = false, updated_at = now()
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

  IF v_action IN ('approve', 'reschedule', 'request_documents', 'send_response',
                  'escalate', 'attach_send', 'attach_breakdown') THEN
    SELECT * INTO v_step FROM public.request_approval_steps
    WHERE request_id = p_request_id AND status = 'in_progress'
    ORDER BY step_order LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_step');
    END IF;

    UPDATE public.request_approval_steps
    SET status = 'completed', decided_by = v_uid, decided_at = now(),
        decision_note = NULLIF(trim(COALESCE(p_reason, '')), ''),
        meta = COALESCE(p_meta, '{}'::jsonb), updated_at = now()
    WHERE id = v_step.id;

    SELECT * INTO v_next FROM public.request_approval_steps
    WHERE request_id = p_request_id AND step_order > v_step.step_order
      AND status = 'pending'
    ORDER BY step_order LIMIT 1;

    IF FOUND THEN
      UPDATE public.request_approval_steps
      SET status = 'in_progress', updated_at = now()
      WHERE id = v_next.id;
      UPDATE public.requests
      SET status = 'in_review',
          current_step_order = v_next.step_order,
          current_step_label = v_next.step_name,
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

    v_status := CASE WHEN v_req.request_type IN ('complaint', 'salary_justification')
                     THEN 'solved' ELSE 'approved' END;

    UPDATE public.requests
    SET status = v_status::public.request_status,
        current_step_label = v_step.step_name,
        current_step_order = v_step.step_order,
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        needs_attention = false, updated_at = now()
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
$$;

-- Visit status → driver inbox (preserve reschedule args)
CREATE OR REPLACE FUNCTION public.admin_update_visit_status(
  p_booking_id uuid,
  p_status public.visit_booking_status,
  p_new_slot_id uuid DEFAULT NULL,
  p_new_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.visit_bookings%ROWTYPE;
  v_title text;
  v_body text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_status = 'confirmed' AND p_new_slot_id IS NOT NULL THEN
    IF NOT public.staff_has_permission('visits.operate') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
    END IF;
  ELSIF p_status IN ('checked_in', 'completed', 'no_show', 'cancelled', 'confirmed') THEN
    IF NOT public.staff_has_permission('visits.operate') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.visit_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  UPDATE public.visit_bookings
  SET
    status = p_status,
    slot_id = COALESCE(p_new_slot_id, slot_id),
    scheduled_date = COALESCE(p_new_date, scheduled_date),
    checked_in_at = CASE WHEN p_status = 'checked_in' THEN COALESCE(checked_in_at, now()) ELSE checked_in_at END,
    completed_at = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
    cancelled_at = CASE WHEN p_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
    updated_at = now()
  WHERE id = p_booking_id;

  v_title := 'Visit ' || replace(p_status::text, '_', ' ') || ' — ' || v_row.booking_code;
  v_body := CASE p_status::text
    WHEN 'checked_in' THEN 'You have been checked in at reception.'
    WHEN 'completed' THEN 'Your visit is marked completed.'
    WHEN 'cancelled' THEN 'Your visit booking was cancelled.'
    WHEN 'no_show' THEN 'Your visit was marked as no-show.'
    ELSE 'Your visit status was updated.'
  END;

  PERFORM public.notify_driver_transactional(
    v_row.driver_id,
    v_title,
    v_body,
    'musallam:///profile/support/visits',
    'operations',
    'normal',
    jsonb_build_object(
      'record_type', 'visit',
      'record_id', p_booking_id::text,
      'route', '/profile/support/visits'
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;
