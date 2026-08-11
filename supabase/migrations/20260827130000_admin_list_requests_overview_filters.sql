-- Overview list (Figma 4149:24182) needs honest counts and two more filters.
-- KPI formulas and the previous-month trend window are locked business rules and are copied verbatim.
--
-- Department is NOT a column on requests. The only real link we have is the current approval step's
-- role_key, so department is derived from it and labelled from request_departments when an admin has
-- configured a matching row. Options come from the approval templates, never from seeded guesses.

-- The two new parameters change the signature, so the 7-arg version must go or named-argument
-- calls from PostgREST become ambiguous.
DROP FUNCTION IF EXISTS public.admin_list_requests(
  timestamptz, timestamptz, text, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.admin_list_requests(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_department_key text DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
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
               r.attention_at, r.created_at, r.severity,
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

GRANT EXECUTE ON FUNCTION public.admin_list_requests(
  timestamptz, timestamptz, text, text, text, integer, integer, text, uuid
) TO authenticated;
