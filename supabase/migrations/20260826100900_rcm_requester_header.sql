-- Figma QA pass 2: additive read-model fix only (no status/RBAC/KPI change).
-- Admin RCM detail + list need requester name/phone/zone to match the
-- Figma requester header (avatar, name, zone, phone, View profile).

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
    'requester', (
      SELECT jsonb_build_object(
        'name', p.full_name,
        'code', d.driver_code,
        'phone', p.phone,
        'zone', z.name
      )
      FROM public.profiles p
      LEFT JOIN public.drivers d ON d.id = p.id
      LEFT JOIN public.zones z ON z.id = d.zone_id
      WHERE p.id = v_req.driver_id
    ),
    'steps', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'step_order')::int)
      FROM (
        SELECT to_jsonb(s) || jsonb_build_object(
          'allowed_actions',
          COALESCE(
            (SELECT t.allowed_actions FROM public.request_approval_step_templates t
             WHERE t.request_type = v_req.request_type AND t.step_order = s.step_order),
            ARRAY[]::text[]
          )
        ) AS x
        FROM public.request_approval_steps s WHERE s.request_id = p_request_id
      ) rows
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
               p.full_name AS driver_name, d.driver_code, z.name AS driver_zone
        FROM public.requests r
        LEFT JOIN public.drivers d ON d.id = r.driver_id
        LEFT JOIN public.profiles p ON p.id = r.driver_id
        LEFT JOIN public.zones z ON z.id = d.zone_id
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
