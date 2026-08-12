-- Puts real behaviour behind the request statuses and the step actions that until now all
-- collapsed into "approve".
--
-- What changes:
--   submitted    stops being a value that lives for microseconds. materialize no longer forces
--                in_review; the first staff action does.
--   rescheduled  reschedule stops advancing the chain. The step stays open, the proposed dates
--                go to the rider, and the rider's answer returns the request to in_review.
--   responded    send_response closes a complaint or salary justification with completed_at,
--                instead of pretending it was approved.
--   closed       archive state, set by staff or by the auto-close sweep.
--   SLA          each step can carry a deadline from its template, and a sweep marks breaches.
--
-- SLA note: breach_action never decides a step. notify and escalate both raise the admin
-- attention badge and differ only in attention_reason, because auto-advancing a step is
-- auto-approving it by another name.

-- ============================================================ materialize

CREATE OR REPLACE FUNCTION public.rcm_materialize_approval_steps(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requests%ROWTYPE;
  v_driver_name text;
  v_active public.request_approval_steps%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  SELECT NULLIF(trim(COALESCE(p.full_name, '')), '')
  INTO v_driver_name
  FROM public.profiles p
  WHERE p.id = v_req.driver_id;

  INSERT INTO public.request_approval_steps (
    request_id, step_order, step_name, role_key, status,
    started_at, decided_at, actor_display_name, sla_due_at, breach_action
  )
  SELECT
    p_request_id,
    t.step_order,
    t.step_name,
    t.role_key,
    CASE
      WHEN t.step_order = 1 THEN 'completed'::public.request_step_status
      WHEN t.step_order = 2 THEN 'in_progress'::public.request_step_status
      ELSE 'pending'::public.request_step_status
    END,
    CASE WHEN t.step_order <= 2 THEN now() END,
    -- Step 1 is the rider's own submission; it is complete the moment it exists.
    CASE WHEN t.step_order = 1 THEN now() END,
    CASE WHEN t.step_order = 1 THEN v_driver_name END,
    CASE
      WHEN t.step_order = 2 AND t.sla_minutes IS NOT NULL
      THEN now() + make_interval(mins => t.sla_minutes)
    END,
    CASE WHEN t.step_order = 2 THEN t.breach_action END
  FROM public.request_approval_step_templates t
  WHERE t.request_type = v_req.request_type
  ORDER BY t.step_order
  ON CONFLICT (request_id, step_order) DO NOTHING;

  SELECT * INTO v_active
  FROM public.request_approval_steps
  WHERE request_id = p_request_id AND status = 'in_progress'
  ORDER BY step_order
  LIMIT 1;

  UPDATE public.requests
  SET
    current_step_order = COALESCE(v_active.step_order, 1),
    current_step_label = COALESCE(v_active.step_name, 'Submitted'),
    -- Nobody has acted yet, so the request is submitted, not in review. The first staff
    -- decision in admin_decide_request moves it on.
    status = 'submitted',
    sla_due_at = v_active.sla_due_at,
    sla_breach_action = v_active.breach_action,
    updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

-- ============================================================ decide

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

    v_status := CASE WHEN v_req.request_type IN ('complaint', 'salary_justification')
                     THEN 'solved' ELSE 'approved' END;

    UPDATE public.requests
    SET status = v_status::public.request_status,
        current_step_label = v_step.step_name,
        current_step_order = v_step.step_order,
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        payload = CASE
          WHEN v_status = 'approved'
               AND v_req.request_type IN ('loan', 'asset', 'sick_leave')
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

-- ============================================================ rider reschedule reply

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

  RETURN jsonb_build_object('ok', true, 'id', p_request_id, 'accepted', p_accept);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.driver_respond_reschedule(uuid, boolean, text) TO authenticated;

-- ============================================================ acknowledgement column

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

  RETURN jsonb_build_object('ok', true, 'id', p_request_id);
END;
$function$;

-- ============================================================ sweeps

-- Auto-close: a decided request that nobody has touched for request_auto_close_days becomes
-- an archive row. Nothing about the decision changes, only its visibility in the open queues.
CREATE OR REPLACE FUNCTION public.admin_auto_close_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days int;
  v_count int := 0;
BEGIN
  SELECT COALESCE(request_auto_close_days, 30) INTO v_days
  FROM public.app_settings
  ORDER BY id
  LIMIT 1;

  IF v_days IS NULL OR v_days <= 0 THEN
    RETURN 0;
  END IF;

  WITH closed AS (
    UPDATE public.requests
    SET status = 'closed',
        closed_at = now(),
        needs_attention = false,
        updated_at = now()
    WHERE status IN ('approved', 'rejected', 'solved', 'responded')
      AND completed_at IS NOT NULL
      AND completed_at < now() - make_interval(days => v_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM closed;

  RETURN v_count;
END;
$function$;

-- SLA sweep: marks the breach and raises the attention badge. It deliberately does not decide
-- or advance the step -- an unattended deadline is a reason to look, not a reason to approve.
CREATE OR REPLACE FUNCTION public.admin_run_request_sla_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  WITH breached AS (
    UPDATE public.request_approval_steps s
    SET sla_breached_at = now(), updated_at = now()
    WHERE s.status = 'in_progress'
      AND s.sla_due_at IS NOT NULL
      AND s.sla_due_at < now()
      AND s.sla_breached_at IS NULL
    RETURNING s.request_id, COALESCE(s.breach_action, 'notify') AS breach_action
  ),
  flagged AS (
    UPDATE public.requests r
    SET needs_attention = true,
        attention_at = now(),
        attention_reason = CASE
          WHEN b.breach_action = 'escalate' THEN 'sla_escalated'
          ELSE 'sla_breach'
        END,
        updated_at = now()
    FROM breached b
    WHERE r.id = b.request_id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM flagged;

  RETURN v_count;
END;
$function$;

-- ============================================================ list KPI terminal statuses

-- The overdue KPI treated only approved/rejected/solved as finished, so every responded or
-- closed request would have started counting as overdue the moment it aged past 15 days.
CREATE OR REPLACE FUNCTION public.admin_list_requests(
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_department_key text DEFAULT NULL::text,
  p_zone_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := p_date_from;
  v_to timestamptz := p_date_to;
  v_total bigint;
  v_pending bigint;
  v_overdue bigint;
  v_avg_seconds numeric;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_prev_total bigint;
  v_prev_pending bigint;
  v_prev_overdue bigint;
  v_prev_avg numeric;
  v_filtered_total bigint;
  v_status_counts jsonb;
  v_open constant text[] := ARRAY[
    'pending', 'submitted', 'in_review', 'needs_clarification', 'rescheduled'
  ];
  v_terminal constant text[] := ARRAY[
    'approved', 'rejected', 'solved', 'responded', 'closed'
  ];
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    v_prev_from := (v_from - interval '1 month');
    v_prev_to := (v_to - interval '1 month');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to);

  SELECT count(*) INTO v_pending
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to)
    AND r.status::text = ANY (v_open);

  SELECT count(*) INTO v_overdue
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to)
    AND r.completed_at IS NULL
    AND NOT (r.status::text = ANY (v_terminal))
    AND r.created_at < (now() - interval '15 days');

  SELECT avg(EXTRACT(EPOCH FROM (r.completed_at - r.created_at))) INTO v_avg_seconds
  FROM public.requests r
  WHERE r.completed_at IS NOT NULL
    AND (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to);

  IF v_prev_from IS NOT NULL THEN
    SELECT count(*) INTO v_prev_total FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to;
    SELECT count(*) INTO v_prev_pending FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to
      AND r.status::text = ANY (v_open);
    SELECT count(*) INTO v_prev_overdue FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to
      AND r.completed_at IS NULL
      AND NOT (r.status::text = ANY (v_terminal))
      AND r.created_at < (now() - interval '15 days');
    SELECT avg(EXTRACT(EPOCH FROM (r.completed_at - r.created_at))) INTO v_prev_avg
    FROM public.requests r
    WHERE r.completed_at IS NOT NULL
      AND r.created_at >= v_prev_from AND r.created_at < v_prev_to;
  END IF;

  -- Everything below shares one filtered base so the "showing X of Y" line and the status tab
  -- counts can never disagree with the rows actually returned.
  WITH base AS (
    SELECT r.id, r.status::text AS status_text
    FROM public.requests r
    LEFT JOIN public.drivers d ON d.id = r.driver_id
    LEFT JOIN public.profiles p ON p.id = r.driver_id
    LEFT JOIN public.request_approval_steps cur
      ON cur.request_id = r.id AND cur.step_order = r.current_step_order
    WHERE (v_from IS NULL OR r.created_at >= v_from)
      AND (v_to IS NULL OR r.created_at < v_to)
      AND (p_type IS NULL OR r.request_type::text = p_type)
      AND (p_zone_id IS NULL OR d.zone_id = p_zone_id)
      AND (p_department_key IS NULL OR cur.role_key = p_department_key)
      AND (
        p_search IS NULL OR p_search = ''
        OR r.request_code ILIKE '%' || p_search || '%'
        OR p.full_name ILIKE '%' || p_search || '%'
        OR d.driver_code ILIKE '%' || p_search || '%'
      )
  ),
  counts AS (
    SELECT status_text, count(*) AS cnt FROM base GROUP BY status_text
  )
  SELECT
    (SELECT count(*) FROM base WHERE p_status IS NULL OR base.status_text = p_status),
    (SELECT COALESCE(jsonb_object_agg(counts.status_text, counts.cnt), '{}'::jsonb) FROM counts)
  INTO v_filtered_total, v_status_counts;

  RETURN jsonb_build_object(
    'ok', true,
    'kpi', jsonb_build_object(
      'total', v_total,
      'pending', v_pending,
      'overdue', v_overdue,
      'avg_resolution_seconds', v_avg_seconds,
      'prev_total', v_prev_total,
      'prev_pending', v_prev_pending,
      'prev_overdue', v_prev_overdue,
      'prev_avg_resolution_seconds', v_prev_avg
    ),
    'filtered_total', COALESCE(v_filtered_total, 0),
    'status_counts', COALESCE(v_status_counts, '{}'::jsonb),
    'department_options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', o.role_key, 'label', o.label) ORDER BY o.label)
      FROM (
        SELECT DISTINCT t.role_key,
               COALESCE(dep.label_en, initcap(replace(t.role_key, '_', ' '))) AS label
        FROM public.request_approval_step_templates t
        LEFT JOIN public.request_departments dep ON dep.key = t.role_key AND dep.is_active
        WHERE t.role_key IS NOT NULL
          AND t.role_key NOT IN ('system')
          AND NOT t.is_system_auto
      ) o
    ), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT r.id, r.request_code, r.request_type, r.status, r.current_step_label,
               r.current_step_order, r.driver_id, r.amount_kwd, r.needs_attention,
               r.attention_at, r.created_at, r.severity, r.sla_due_at,
               COALESCE((r.payload->>'awaiting_driver_ack')::boolean, false) AS awaiting_driver_ack,
               p.full_name AS driver_name, d.driver_code, z.name AS driver_zone,
               cur.role_key AS department_key,
               COALESCE(dep.label_en, initcap(replace(cur.role_key, '_', ' '))) AS department_label
        FROM public.requests r
        LEFT JOIN public.drivers d ON d.id = r.driver_id
        LEFT JOIN public.profiles p ON p.id = r.driver_id
        LEFT JOIN public.zones z ON z.id = d.zone_id
        LEFT JOIN public.request_approval_steps cur
          ON cur.request_id = r.id AND cur.step_order = r.current_step_order
        LEFT JOIN public.request_departments dep
          ON dep.key = cur.role_key AND dep.is_active
        WHERE (v_from IS NULL OR r.created_at >= v_from)
          AND (v_to IS NULL OR r.created_at < v_to)
          AND (p_status IS NULL OR r.status::text = p_status)
          AND (p_type IS NULL OR r.request_type::text = p_type)
          AND (p_zone_id IS NULL OR d.zone_id = p_zone_id)
          AND (p_department_key IS NULL OR cur.role_key = p_department_key)
          AND (
            p_search IS NULL OR p_search = ''
            OR r.request_code ILIKE '%' || p_search || '%'
            OR p.full_name ILIKE '%' || p_search || '%'
            OR d.driver_code ILIKE '%' || p_search || '%'
          )
        ORDER BY r.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$function$;
