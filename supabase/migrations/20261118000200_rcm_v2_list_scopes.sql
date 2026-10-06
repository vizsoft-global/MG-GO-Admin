-- RCM V2 list scopes. CREATE OR REPLACE cannot widen the argument list, so
-- every existing admin_list_requests overload is dropped and one 14-arg form
-- is created. New params default NULL, so a 9-arg PostgREST call is unchanged.
-- The extra predicates live in the same `filtered` CTE the KPIs already share.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_list_requests'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END
$$;

CREATE FUNCTION public.admin_list_requests(
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_department_key text DEFAULT NULL::text,
  p_zone_id uuid DEFAULT NULL::uuid,
  p_assigned_to_me boolean DEFAULT NULL::boolean,
  p_forwarded_to_me boolean DEFAULT NULL::boolean,
  p_handled_by_me boolean DEFAULT NULL::boolean,
  p_due_today boolean DEFAULT NULL::boolean,
  p_sort text DEFAULT NULL::text
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
  v_uid uuid := auth.uid();
  v_today date := (timezone('Asia/Kuwait', now()))::date;
  v_oldest boolean := lower(COALESCE(p_sort, '')) IN ('oldest', 'oldest_first', 'asc');
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

  WITH filtered AS (
    SELECT r.id, r.status::text AS status_text, r.created_at, r.completed_at
    FROM public.requests r
    LEFT JOIN public.drivers d ON d.id = r.driver_id
    LEFT JOIN public.profiles p ON p.id = r.driver_id
    LEFT JOIN public.request_approval_steps cur
      ON cur.request_id = r.id AND cur.step_order = r.current_step_order
    WHERE (p_type IS NULL OR r.request_type::text = p_type)
      AND (p_zone_id IS NULL OR d.zone_id = p_zone_id)
      AND (p_department_key IS NULL OR cur.role_key = p_department_key)
      AND (
        p_search IS NULL OR p_search = ''
        OR r.request_code ILIKE '%' || p_search || '%'
        OR (
          NOT r.is_confidential
          AND (
            p.full_name ILIKE '%' || p_search || '%'
            OR d.driver_code ILIKE '%' || p_search || '%'
          )
        )
      )
      AND (
        p_assigned_to_me IS NOT TRUE
        OR r.assigned_to = v_uid
        OR cur.assigned_user_id = v_uid
      )
      AND (
        p_forwarded_to_me IS NOT TRUE
        OR EXISTS (
          SELECT 1 FROM public.request_forwards f
          WHERE f.request_id = r.id AND f.to_user = v_uid
        )
      )
      AND (
        p_handled_by_me IS NOT TRUE
        OR EXISTS (
          SELECT 1 FROM public.request_approval_steps s
          WHERE s.request_id = r.id AND s.decided_by = v_uid
        )
      )
      AND (
        p_due_today IS NOT TRUE
        OR (
          r.sla_due_at IS NOT NULL
          AND (timezone('Asia/Kuwait', r.sla_due_at))::date = v_today
        )
      )
  ),
  base AS (
    SELECT * FROM filtered
    WHERE (v_from IS NULL OR created_at >= v_from)
      AND (v_to IS NULL OR created_at < v_to)
  ),
  prev AS (
    SELECT * FROM filtered
    WHERE v_prev_from IS NOT NULL
      AND created_at >= v_prev_from
      AND created_at < v_prev_to
  ),
  counts AS (
    SELECT status_text, count(*) AS cnt FROM base GROUP BY status_text
  )
  SELECT
    (SELECT count(*) FROM base),
    (SELECT count(*) FROM base WHERE status_text = ANY (v_open)),
    (SELECT count(*) FROM base
      WHERE completed_at IS NULL
        AND NOT (status_text = ANY (v_terminal))
        AND created_at < (now() - interval '15 days')),
    (SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at)))
      FROM base WHERE completed_at IS NOT NULL),
    CASE WHEN v_prev_from IS NOT NULL THEN (SELECT count(*) FROM prev) END,
    CASE WHEN v_prev_from IS NOT NULL
      THEN (SELECT count(*) FROM prev WHERE status_text = ANY (v_open)) END,
    CASE WHEN v_prev_from IS NOT NULL
      THEN (SELECT count(*) FROM prev
        WHERE completed_at IS NULL
          AND NOT (status_text = ANY (v_terminal))
          AND created_at < (now() - interval '15 days')) END,
    CASE WHEN v_prev_from IS NOT NULL
      THEN (SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at)))
        FROM prev WHERE completed_at IS NOT NULL) END,
    (SELECT count(*) FROM base WHERE p_status IS NULL OR status_text = p_status),
    (SELECT COALESCE(jsonb_object_agg(counts.status_text, counts.cnt), '{}'::jsonb) FROM counts)
  INTO v_total, v_pending, v_overdue, v_avg_seconds,
       v_prev_total, v_prev_pending, v_prev_overdue, v_prev_avg,
       v_filtered_total, v_status_counts;

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
      SELECT CASE WHEN v_oldest
        THEN jsonb_agg(to_jsonb(x) ORDER BY x.created_at ASC)
        ELSE jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
      END
      FROM (
        SELECT r.id, r.request_code, r.request_type, r.status, r.current_step_label,
               r.current_step_order, r.driver_id, r.amount_kwd, r.needs_attention,
               r.attention_at, r.created_at, r.severity, r.sla_due_at,
               r.is_confidential,
               COALESCE((r.payload->>'awaiting_driver_ack')::boolean, false) AS awaiting_driver_ack,
               CASE WHEN r.is_confidential THEN NULL ELSE p.full_name END AS driver_name,
               CASE WHEN r.is_confidential THEN NULL ELSE d.driver_code END AS driver_code,
               CASE WHEN r.is_confidential THEN NULL ELSE d.employee_id END AS employee_id,
               CASE WHEN r.is_confidential THEN NULL ELSE d.project_key END AS project_key,
               CASE WHEN r.is_confidential THEN NULL ELSE z.name END AS driver_zone,
               r.is_confidential AS sender_masked,
               cur.role_key AS department_key,
               COALESCE(dep.label_en, initcap(replace(cur.role_key, '_', ' '))) AS department_label,
               r.assigned_to,
               cur.assigned_user_id
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
            OR (
              NOT r.is_confidential
              AND (
                p.full_name ILIKE '%' || p_search || '%'
                OR d.driver_code ILIKE '%' || p_search || '%'
              )
            )
          )
          AND (
            p_assigned_to_me IS NOT TRUE
            OR r.assigned_to = v_uid
            OR cur.assigned_user_id = v_uid
          )
          AND (
            p_forwarded_to_me IS NOT TRUE
            OR EXISTS (
              SELECT 1 FROM public.request_forwards f
              WHERE f.request_id = r.id AND f.to_user = v_uid
            )
          )
          AND (
            p_handled_by_me IS NOT TRUE
            OR EXISTS (
              SELECT 1 FROM public.request_approval_steps s
              WHERE s.request_id = r.id AND s.decided_by = v_uid
            )
          )
          AND (
            p_due_today IS NOT TRUE
            OR (
              r.sla_due_at IS NOT NULL
              AND (timezone('Asia/Kuwait', r.sla_due_at))::date = v_today
            )
          )
        ORDER BY
          CASE WHEN v_oldest THEN r.created_at END ASC,
          CASE WHEN NOT v_oldest THEN r.created_at END DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_requests(
  timestamptz, timestamptz, text, text, text, integer, integer, text, uuid,
  boolean, boolean, boolean, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_requests(
  timestamptz, timestamptz, text, text, text, integer, integer, text, uuid,
  boolean, boolean, boolean, boolean, text
) TO authenticated, service_role;
