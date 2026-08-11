-- Reports (Figma 4149:26320) needs a department breakdown. Department is still NOT a column on
-- `requests`; it is the approval step's role_key, exactly as in 20260827130000.
--
-- A request passes through several departments, so whole-request resolution time cannot honestly be
-- attributed to one team. What we can measure per department is the time a request spent waiting on
-- that department's own step: decided_at minus the previous decided step, falling back to
-- requests.created_at for the first step. Steps never reached (step_order beyond the request's
-- current step) are excluded — they are not that department's work yet.
--
-- 'approved' is the step enum value 'completed'; the system auto step is excluded like everywhere else.

CREATE OR REPLACE FUNCTION public.admin_request_department_report(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  WITH reached AS (
    SELECT
      s.request_id,
      s.role_key,
      s.status::text AS step_status,
      s.decided_at,
      COALESCE(
        max(s.decided_at) OVER (
          PARTITION BY s.request_id ORDER BY s.step_order
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        r.created_at
      ) AS entered_at
    FROM public.request_approval_steps s
    JOIN public.requests r ON r.id = s.request_id
    WHERE s.role_key IS NOT NULL
      AND s.role_key <> 'system'
      AND s.step_order <= COALESCE(r.current_step_order, s.step_order)
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at < p_date_to)
  ),
  agg AS (
    SELECT
      reached.role_key,
      COALESCE(dep.label_en, initcap(replace(reached.role_key, '_', ' '))) AS label,
      count(DISTINCT reached.request_id) AS requests,
      count(*) FILTER (WHERE reached.step_status = 'completed') AS approved,
      count(*) FILTER (WHERE reached.step_status = 'rejected') AS rejected,
      avg(EXTRACT(EPOCH FROM (reached.decided_at - reached.entered_at)))
        FILTER (WHERE reached.decided_at IS NOT NULL) AS avg_step_seconds
    FROM reached
    LEFT JOIN public.request_departments dep
      ON dep.key = reached.role_key AND dep.is_active
    GROUP BY reached.role_key, dep.label_en
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'department_key', agg.role_key,
        'department_label', agg.label,
        'requests', agg.requests,
        'approved', agg.approved,
        'rejected', agg.rejected,
        'avg_step_seconds', agg.avg_step_seconds
      )
      ORDER BY agg.requests DESC, agg.label
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM agg;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_request_department_report(timestamptz, timestamptz)
  TO authenticated;
