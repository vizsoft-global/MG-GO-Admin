-- Figma QA pass: additive read-model fixes only (no KPI formula, RBAC, or
-- duplicate-booking rule changes).
-- 1. admin_get_request: attach allowed_actions per step (join templates) so
--    the admin detail page can render the correct typed action buttons.
-- 2. admin_count_requests_by_type: per-type totals for the RCM hub tile badges.
-- 3. admin_list_visits: attach slot_start/slot_end/branch_name (for the
--    calendar day-board) and a kpi block (for All-visits KPI cards).

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

CREATE OR REPLACE FUNCTION public.admin_count_requests_by_type()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'counts', COALESCE((
      SELECT jsonb_object_agg(x.request_type, jsonb_build_object('total', x.total, 'pending', x.pending))
      FROM (
        SELECT r.request_type::text AS request_type,
               count(*) AS total,
               count(*) FILTER (
                 WHERE r.status IN ('pending', 'submitted', 'in_review', 'needs_clarification')
               ) AS pending
        FROM public.requests r
        GROUP BY r.request_type
      ) x
    ), '{}'::jsonb)
  );
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
DECLARE
  v_today date := current_date;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('visits.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kpi', jsonb_build_object(
      'today', (SELECT count(*) FROM public.visit_bookings WHERE scheduled_date = v_today),
      'today_checked_in', (
        SELECT count(*) FROM public.visit_bookings
        WHERE scheduled_date = v_today AND status IN ('checked_in', 'completed')
      ),
      'upcoming', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'confirmed' AND scheduled_date > v_today AND scheduled_date <= v_today + 7
      ),
      'awaiting_checkin', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'confirmed' AND scheduled_date = v_today
      ),
      'no_shows', (
        SELECT count(*) FROM public.visit_bookings
        WHERE status = 'no_show' AND scheduled_date >= v_today - 7
      )
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scheduled_date DESC, x.created_at DESC)
      FROM (
        SELECT vb.*, p.full_name AS driver_name, d.driver_code,
               vd.label_en AS department_label,
               vs.start_time AS slot_start, vs.end_time AS slot_end,
               vbr.name AS branch_name
        FROM public.visit_bookings vb
        LEFT JOIN public.drivers d ON d.id = vb.driver_id
        LEFT JOIN public.profiles p ON p.id = vb.driver_id
        LEFT JOIN public.visit_departments vd ON vd.key = vb.department_key
        LEFT JOIN public.visit_slots vs ON vs.id = vb.slot_id
        LEFT JOIN public.visit_branches vbr ON vbr.id = vb.branch_id
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

GRANT EXECUTE ON FUNCTION public.admin_count_requests_by_type() TO authenticated, service_role;
