-- RCM + Visit Booking RPCs (Phase 2–3)
-- Permissions already seeded; this adds staff permission helper + business RPCs.

CREATE OR REPLACE FUNCTION public.staff_has_permission(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
      WHERE p.id = auth.uid()
        AND arp.permission_slug = p_slug
    );
$$;

REVOKE ALL ON FUNCTION public.staff_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_has_permission(text) TO authenticated, service_role;

-- Materialize approval steps from templates for a request
CREATE OR REPLACE FUNCTION public.rcm_materialize_approval_steps(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.request_type;
  v_first_label text;
BEGIN
  SELECT request_type INTO v_type FROM public.requests WHERE id = p_request_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  INSERT INTO public.request_approval_steps (
    request_id, step_order, step_name, role_key, status
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
    END
  FROM public.request_approval_step_templates t
  WHERE t.request_type = v_type
  ORDER BY t.step_order
  ON CONFLICT (request_id, step_order) DO NOTHING;

  SELECT step_name INTO v_first_label
  FROM public.request_approval_steps
  WHERE request_id = p_request_id AND status = 'in_progress'
  ORDER BY step_order
  LIMIT 1;

  UPDATE public.requests
  SET
    current_step_order = COALESCE((
      SELECT step_order FROM public.request_approval_steps
      WHERE request_id = p_request_id AND status = 'in_progress'
      ORDER BY step_order LIMIT 1
    ), 1),
    current_step_label = COALESCE(v_first_label, 'Submitted'),
    status = 'in_review',
    updated_at = now()
  WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_create_request(
  p_type public.request_type,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_amount_kwd numeric DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_details text DEFAULT NULL,
  p_severity public.severity_level DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text;
  v_att jsonb;
  v_tenure int;
  v_cat text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_uid AND d.archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  -- Gated: loan tenure must exist in config (empty table blocks loan submit)
  IF p_type = 'loan' THEN
    v_tenure := NULLIF((p_payload ->> 'tenure_months'), '')::int;
    IF v_tenure IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tenure_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.loan_tenure_options WHERE months = v_tenure AND is_active) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tenure_options_not_configured');
    END IF;
  END IF;

  -- Gated: complaint category must exist (empty table blocks)
  IF p_type = 'complaint' THEN
    v_cat := nullif(trim(p_payload ->> 'category'), '');
    IF v_cat IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_required');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.complaint_categories c
      WHERE c.is_active AND (c.key = v_cat OR c.label_en = v_cat)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'complaint_categories_not_configured');
    END IF;
  END IF;

  -- Minimal required-field checks (Figma matrices)
  IF p_type IN ('leave', 'sick_leave') THEN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_date_range');
    END IF;
  END IF;

  IF p_type = 'sick_leave' AND jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'medical_documents_required');
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
$$;

CREATE OR REPLACE FUNCTION public.driver_list_my_requests(
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM (
        SELECT id, request_code, request_type, status, current_step_label,
               current_step_order, amount_kwd, start_date, end_date,
               created_at, updated_at, completed_at, severity
        FROM public.requests
        WHERE driver_id = v_uid
          AND (p_status IS NULL OR status::text = p_status)
        ORDER BY created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) r
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id AND driver_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request', to_jsonb(v_req),
    'steps', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.step_order)
      FROM public.request_approval_steps s WHERE s.request_id = p_request_id
    ), '[]'::jsonb),
    'clarifications', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.asked_at)
      FROM public.request_clarifications c WHERE c.request_id = p_request_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
      FROM public.request_attachments a WHERE a.request_id = p_request_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_submit_clarification(
  p_request_id uuid,
  p_answer text,
  p_attachment_keys text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN jsonb_build_object('ok', true, 'clarification_id', v_clar_id);
END;
$$;

-- Admin: clear attention badge on open
CREATE OR REPLACE FUNCTION public.admin_clear_request_attention(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  UPDATE public.requests
  SET
    needs_attention = false,
    attention_cleared_at = now(),
    updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Opening clears attention (client-confirmed)
  PERFORM public.admin_clear_request_attention(p_request_id);
  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request', to_jsonb(v_req),
    'steps', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.step_order)
      FROM public.request_approval_steps s WHERE s.request_id = p_request_id
    ), '[]'::jsonb),
    'clarifications', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.asked_at)
      FROM public.request_clarifications c WHERE c.request_id = p_request_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
      FROM public.request_attachments a WHERE a.request_id = p_request_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_requests(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- Previous month window for trend (client-confirmed)
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
    AND r.status IN ('pending', 'submitted', 'in_review', 'needs_clarification');

  SELECT count(*) INTO v_overdue
  FROM public.requests r
  WHERE (v_from IS NULL OR r.created_at >= v_from)
    AND (v_to IS NULL OR r.created_at < v_to)
    AND r.completed_at IS NULL
    AND r.status NOT IN ('approved', 'rejected', 'solved')
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
      AND r.status IN ('pending', 'submitted', 'in_review', 'needs_clarification');
    SELECT count(*) INTO v_prev_overdue FROM public.requests r
    WHERE r.created_at >= v_prev_from AND r.created_at < v_prev_to
      AND r.completed_at IS NULL
      AND r.status NOT IN ('approved', 'rejected', 'solved')
      AND r.created_at < (now() - interval '15 days');
    SELECT avg(EXTRACT(EPOCH FROM (r.completed_at - r.created_at))) INTO v_prev_avg
    FROM public.requests r
    WHERE r.completed_at IS NOT NULL
      AND r.created_at >= v_prev_from AND r.created_at < v_prev_to;
  END IF;

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
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT r.id, r.request_code, r.request_type, r.status, r.current_step_label,
               r.current_step_order, r.driver_id, r.amount_kwd, r.needs_attention,
               r.attention_at, r.created_at, r.severity,
               p.full_name AS driver_name, d.driver_code
        FROM public.requests r
        LEFT JOIN public.drivers d ON d.id = r.driver_id
        LEFT JOIN public.profiles p ON p.id = r.driver_id
        WHERE (v_from IS NULL OR r.created_at >= v_from)
          AND (v_to IS NULL OR r.created_at < v_to)
          AND (p_status IS NULL OR r.status::text = p_status)
          AND (p_type IS NULL OR r.request_type::text = p_type)
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
$$;

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
    RETURN jsonb_build_object('ok', true, 'status', 'needs_clarification');
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
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF v_action = 'solve' THEN
    UPDATE public.requests
    SET status = 'solved', decided_by = v_uid, decided_at = now(),
        completed_at = now(), decision_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
        needs_attention = false, updated_at = now()
    WHERE id = p_request_id;
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
      RETURN jsonb_build_object('ok', true, 'status', 'in_review', 'step', v_next.step_order);
    END IF;

    UPDATE public.requests
    SET status = CASE WHEN v_req.request_type IN ('complaint', 'salary_justification')
                      THEN 'solved'::public.request_status
                      ELSE 'approved'::public.request_status END,
        current_step_label = v_step.step_name,
        current_step_order = v_step.step_order,
        decided_by = v_uid, decided_at = now(), completed_at = now(),
        needs_attention = false, updated_at = now()
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', CASE WHEN v_req.request_type IN ('complaint', 'salary_justification')
                     THEN 'solved' ELSE 'approved' END
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_step_template(
  p_request_type public.request_type,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_steps');
  END IF;

  DELETE FROM public.request_approval_step_templates WHERE request_type = p_request_type;

  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    INSERT INTO public.request_approval_step_templates (
      request_type, step_order, step_name, role_key, is_system_auto, allowed_actions
    ) VALUES (
      p_request_type,
      (v_step ->> 'step_order')::int,
      v_step ->> 'step_name',
      v_step ->> 'role_key',
      COALESCE((v_step ->> 'is_system_auto')::boolean, false),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_step -> 'allowed_actions')),
        ARRAY['approve', 'reject']::text[]
      )
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Visit slots with remaining capacity
CREATE OR REPLACE FUNCTION public.driver_list_visit_slots(
  p_date date,
  p_department_key text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'start_time', s.start_time,
        'end_time', s.end_time,
        'capacity', s.capacity,
        'booked', COALESCE(b.cnt, 0),
        'remaining', GREATEST(s.capacity - COALESCE(b.cnt, 0), 0),
        'full', (COALESCE(b.cnt, 0) >= s.capacity)
      ) ORDER BY s.start_time)
      FROM public.visit_slots s
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS cnt
        FROM public.visit_bookings vb
        WHERE vb.slot_id = s.id
          AND vb.scheduled_date = p_date
          AND vb.status IN ('confirmed', 'checked_in')
      ) b ON true
      WHERE s.is_active
        AND s.department_key = p_department_key
        AND (s.slot_date = p_date OR (
          s.slot_date IS NULL
          AND s.day_of_week = EXTRACT(DOW FROM p_date)::int
        ))
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_book_visit(
  p_department_key text,
  p_date date,
  p_slot_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_slot public.visit_slots%ROWTYPE;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.visit_departments
    WHERE key = p_department_key AND is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_department');
  END IF;

  SELECT * INTO v_slot FROM public.visit_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR NOT v_slot.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.visit_bookings
  WHERE slot_id = p_slot_id
    AND scheduled_date = p_date
    AND status IN ('confirmed', 'checked_in');

  IF v_booked >= v_slot.capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_full');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit_bookings
    WHERE driver_id = v_uid
      AND scheduled_date = p_date
      AND department_key = p_department_key
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END IF;

  SELECT id INTO v_branch FROM public.visit_branches
  WHERE key = 'central_tower' AND is_active LIMIT 1;

  v_code := public.allocate_visit_booking_code();

  BEGIN
    INSERT INTO public.visit_bookings (
      booking_code, driver_id, department_key, branch_id, slot_id,
      scheduled_date, note, status
    ) VALUES (
      v_code, v_uid, p_department_key, COALESCE(v_slot.branch_id, v_branch),
      p_slot_id, p_date, NULLIF(trim(COALESCE(p_note, '')), ''), 'confirmed'
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'duplicate_department_date',
      'message', 'Already booked for this department on this date.'
    );
  END;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'booking_code', v_code, 'status', 'confirmed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_cancel_visit(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.visit_bookings
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = p_booking_id
    AND driver_id = v_uid
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

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
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- Head Office may view; Operator may change status / reschedule / cancel / check-in
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

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_visits(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('visits.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scheduled_date DESC, x.created_at DESC)
      FROM (
        SELECT vb.*, p.full_name AS driver_name, d.driver_code,
               vd.label_en AS department_label
        FROM public.visit_bookings vb
        LEFT JOIN public.drivers d ON d.id = vb.driver_id
        LEFT JOIN public.profiles p ON p.id = vb.driver_id
        LEFT JOIN public.visit_departments vd ON vd.key = vb.department_key
        WHERE (p_date_from IS NULL OR vb.scheduled_date >= p_date_from)
          AND (p_date_to IS NULL OR vb.scheduled_date <= p_date_to)
          AND (p_status IS NULL OR vb.status::text = p_status)
        ORDER BY vb.scheduled_date DESC, vb.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rcm_materialize_approval_steps(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_create_request(public.request_type, jsonb, jsonb, numeric, date, date, text, public.severity_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_list_my_requests(text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_get_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_submit_clarification(uuid, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_request_attention(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_requests(timestamptz, timestamptz, text, text, text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_decide_request(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_step_template(public.request_type, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_list_visit_slots(date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_book_visit(text, date, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_cancel_visit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_visit_status(uuid, public.visit_booking_status, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_visits(date, date, text, int, int) TO authenticated, service_role;
