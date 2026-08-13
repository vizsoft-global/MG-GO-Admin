-- Per-type behaviour moves out of hardcoded branches and into the definitions.
--
-- Three things differed per request type in PL/pgSQL: the create-time gates
-- (loan tenure, complaint category, leave date range, sick-leave attachment),
-- the status a final approval lands on (`solved` vs `approved`), and whether the
-- rider has to acknowledge. All three now read from `request_type_definitions`
-- and `request_field_definitions`, so a type added through the builder gets the
-- same machinery without a migration.
--
-- Behaviour for the 8 built-ins is unchanged, including the exact error codes the
-- driver app already translates. Two deliberate exceptions, both strictly safer:
--
--   * A non-numeric `tenure_months` used to raise a Postgres cast error (22P02)
--     that surfaced to the rider as an unhandled exception. It now returns
--     `tenure_options_not_configured` like any other unknown tenure.
--   * An inactive request type is now rejected on create. The flag existed but
--     nothing read it, so today it is inert -- all 8 types are active.
--
-- Static option lists are deliberately NOT validated server-side, exactly as
-- before: an installed app build carries its own copy of those lists, and an
-- admin editing one must not retroactively reject submissions from a build that
-- has not been updated yet.

-- ---------------------------------------------------------------------------
-- Generic create-time validation. Returns NULL when the input is acceptable,
-- otherwise the error code to hand back to the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rcm_validate_request_input(
  p_type text,
  p_payload jsonb,
  p_attachments jsonb,
  p_amount_kwd numeric,
  p_start_date date,
  p_end_date date,
  p_details text,
  p_severity public.severity_level
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_def public.request_type_definitions%ROWTYPE;
  v_field public.request_field_definitions%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_value text;
  v_present boolean;
BEGIN
  SELECT * INTO v_def FROM public.request_type_definitions WHERE key = p_type;
  IF NOT FOUND THEN
    RETURN 'unknown_request_type';
  END IF;
  IF NOT v_def.is_active THEN
    RETURN 'request_type_inactive';
  END IF;

  FOR v_field IN
    SELECT * FROM public.request_field_definitions
    WHERE type_key = p_type
    ORDER BY sort_order, field_key
  LOOP
    -- Attachments are governed by min_attachments below, not per field: a form can
    -- show several upload slots that all land in the same attachment array.
    CONTINUE WHEN v_field.kind = 'file' OR v_field.target = 'attachments';

    v_value := CASE v_field.target
      WHEN 'amount_kwd' THEN CASE WHEN p_amount_kwd IS NULL THEN NULL ELSE p_amount_kwd::text END
      WHEN 'start_date' THEN CASE WHEN p_start_date IS NULL THEN NULL ELSE p_start_date::text END
      WHEN 'end_date'   THEN CASE WHEN p_end_date IS NULL THEN NULL ELSE p_end_date::text END
      WHEN 'details'    THEN p_details
      WHEN 'severity'   THEN CASE WHEN p_severity IS NULL THEN NULL ELSE p_severity::text END
      ELSE v_payload ->> v_field.field_key
    END;
    v_value := NULLIF(trim(COALESCE(v_value, '')), '');
    v_present := v_value IS NOT NULL;

    IF v_field.is_server_required AND NOT v_present THEN
      RETURN COALESCE(v_field.required_error_code, 'field_required:' || v_field.field_key);
    END IF;

    -- Only the DB-backed lists are checked. An empty list is what blocks the type
    -- entirely, which is the behaviour the client relies on to grey out submit.
    IF v_present AND v_field.options_source = 'loan_tenure_options' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.loan_tenure_options
        WHERE is_active AND months::text = v_value
      ) THEN
        RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
      END IF;
    ELSIF v_present AND v_field.options_source = 'complaint_categories' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.complaint_categories
        WHERE is_active AND (key = v_value OR label_en = v_value)
      ) THEN
        RETURN COALESCE(v_field.options_error_code, 'invalid_option:' || v_field.field_key);
      END IF;
    END IF;
  END LOOP;

  IF v_def.date_range_required THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RETURN 'invalid_date_range';
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < v_def.min_attachments THEN
    RETURN COALESCE(v_def.attachments_error_code, 'attachments_required');
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rcm_validate_request_input(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rcm_validate_request_input(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level) IS
  'Internal helper for the request create RPCs. Returns an error code, or NULL when valid.';

-- ---------------------------------------------------------------------------
-- driver_create_request — same contract, generic gates.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_create_request(
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL::numeric,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_details text DEFAULT NULL::text,
  p_severity public.severity_level DEFAULT NULL::public.severity_level
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

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.driver_create_request(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_create_request(
  text, jsonb, jsonb, numeric, date, date, text, public.severity_level) TO authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_request — same contract, generic gates.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_request(
  p_driver_id uuid,
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL::numeric,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_details text DEFAULT NULL::text,
  p_severity public.severity_level DEFAULT NULL::public.severity_level
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_payload jsonb;
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_error text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id AND d.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  v_error := public.rcm_validate_request_input(
    p_type, p_payload, p_attachments, p_amount_kwd, p_start_date, p_end_date, p_details, p_severity);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_error);
  END IF;

  SELECT NULLIF(trim(COALESCE(p.full_name, '')), '') INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- Audit trail + driver app both need to tell a phoned-in request apart from a self-service one.
  v_payload := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
    'created_on_behalf', true,
    'created_on_behalf_by', v_uid,
    'created_on_behalf_by_name', COALESCE(v_actor_name, 'Admin'),
    'created_on_behalf_at', now()
  );

  v_code := public.allocate_request_code();

  INSERT INTO public.requests (
    request_code, driver_id, request_type, status, payload,
    amount_kwd, start_date, end_date, details, severity,
    needs_attention, attention_at, attention_reason
  ) VALUES (
    v_code, p_driver_id, p_type, 'submitted', v_payload,
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

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'request_code', v_code);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_create_request(
  uuid, text, jsonb, jsonb, numeric, date, date, text, public.severity_level) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_request(
  uuid, text, jsonb, jsonb, numeric, date, date, text, public.severity_level) TO authenticated;

COMMENT ON FUNCTION public.admin_create_request(
  uuid, text, jsonb, jsonb, numeric, date, date, text, public.severity_level) IS
  'Raise a request on behalf of a rider. Stamps payload.created_on_behalf*; requires requests.manage.';

-- ---------------------------------------------------------------------------
-- admin_decide_request — terminal status and the acknowledgement requirement now
-- come from the type definition instead of two hardcoded IN lists.
-- ---------------------------------------------------------------------------

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

  -- Close runs before the terminal guard: it is the one action whose whole point is to act on
  -- an already-decided request.
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

  -- A rescheduled request is waiting on the rider, not on staff.
  IF v_req.status = 'rescheduled' AND v_action <> 'clarify' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_driver_reschedule');
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

  -- Reschedule holds the chain. The approver is proposing dates, not deciding.
  IF v_action = 'reschedule' THEN
    v_new_start := NULLIF(p_meta ->> 'new_start_date', '')::date;
    v_new_end := NULLIF(p_meta ->> 'new_end_date', '')::date;
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

  -- Send response answers the rider and ends the request. Complaints and salary
  -- justifications have no approval to grant, so "approved" was always the wrong word.
  IF v_action = 'send_response' THEN
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'response_required');
    END IF;

    UPDATE public.request_approval_steps
    SET status = 'completed', decided_by = v_uid, decided_at = now(),
        actor_display_name = COALESCE(v_actor_name, actor_display_name),
        decision_note = trim(p_reason),
        meta = COALESCE(meta, '{}'::jsonb) || COALESCE(p_meta, '{}'::jsonb),
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
        meta = COALESCE(p_meta, '{}'::jsonb), updated_at = now()
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
