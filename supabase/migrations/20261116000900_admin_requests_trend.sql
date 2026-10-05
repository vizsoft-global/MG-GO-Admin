-- Requests → Reports computed its aggregates on the client, from a list page that
-- was capped at 1000 rows.
--
-- `requests-reports-panel.tsx` asked for `limit: 1000, offset: 0` and then derived
-- every number on the page from that array: the total, the type and status
-- breakdowns, "pending acknowledgement", the approval rate, and the twelve weekly
-- volume bars. Below 1000 rows in the window the page was correct by accident, so
-- nothing looked wrong; above it one request past the cap silently stopped
-- counting everywhere at once, and the chart's 12th bar (the current week) is the
-- bar an operator actually looks at. A number that is quietly short is the same
-- failure as one that is quietly long.
--
-- The aggregate now comes from one statement over the whole filtered set, so the
-- figures on the page cannot be capped by a row limit that exists for a different
-- consumer. The **filter predicate is `admin_list_requests`'s** — the same date
-- window, type, status, department, zone and search — so the reports page and the
-- list page it links from still describe one population, which is the property
-- the 2026-10-04 `filtered` CTE work established for the KPI strip.
--
-- The volume buckets deliberately keep the client's own definition rather than
-- switching to ISO weeks: rolling 7-day windows counted back from now, oldest
-- first, last bucket = the current week. `weeklyVolume` was never ISO-week
-- anchored despite its comment, and quietly re-basing the chart onto calendar
-- weeks would move every bar on the screen for a reason no operator asked for.
--
-- `p_limit`/`p_offset` are absent because there is nothing to page: the caller
-- gets buckets, not rows.
CREATE OR REPLACE FUNCTION public.admin_requests_trend(
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_type text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_department_key text DEFAULT NULL::text,
  p_zone_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_weeks integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_weeks int := GREATEST(COALESCE(p_weeks, 12), 1);
  v_total bigint;
  v_pending_ack bigint;
  v_approved bigint;
  v_rejected bigint;
  v_by_type jsonb;
  v_by_status jsonb;
  v_volume jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  WITH filtered AS (
    SELECT r.id, r.status::text AS status_text, r.request_type::text AS type_text,
           r.created_at, r.completed_at,
           COALESCE((r.payload->>'awaiting_driver_ack')::boolean, false) AS awaiting_driver_ack
    FROM public.requests r
    LEFT JOIN public.drivers d ON d.id = r.driver_id
    LEFT JOIN public.profiles p ON p.id = r.driver_id
    LEFT JOIN public.request_approval_steps cur
      ON cur.request_id = r.id AND cur.step_order = r.current_step_order
    WHERE (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at < p_date_to)
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
  ),
  by_type AS (
    SELECT type_text, count(*) AS cnt FROM filtered GROUP BY type_text
  ),
  by_status AS (
    SELECT status_text, count(*) AS cnt FROM filtered GROUP BY status_text
  ),
  -- One pass for the buckets. `weeks_ago` is a rolling 7-day window counted back
  -- from now, matching the client's `floor((now - created) / 7d)` exactly; the
  -- oldest bucket is index 1 and the newest is index `p_weeks`.
  volume_agg AS (
    SELECT
      v_weeks - 1 - floor(EXTRACT(EPOCH FROM (now() - created_at)) / 604800)::int AS idx,
      count(*) AS cnt
    FROM filtered
    WHERE created_at <= now()
      AND floor(EXTRACT(EPOCH FROM (now() - created_at)) / 604800) < v_weeks
    GROUP BY 1
  )
  SELECT
    (SELECT count(*) FROM filtered),
    (SELECT count(*) FROM filtered WHERE awaiting_driver_ack),
    (SELECT count(*) FROM filtered WHERE status_text = 'approved'),
    (SELECT count(*) FROM filtered WHERE status_text = 'rejected'),
    (SELECT COALESCE(jsonb_object_agg(by_type.type_text, by_type.cnt), '{}'::jsonb) FROM by_type),
    (SELECT COALESCE(jsonb_object_agg(by_status.status_text, by_status.cnt), '{}'::jsonb)
       FROM by_status),
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('label', 'W' || g.idx, 'count', COALESCE(v.cnt, 0))
        ORDER BY g.idx
      ), '[]'::jsonb)
      FROM generate_series(1, v_weeks) AS g(idx)
      LEFT JOIN volume_agg v ON v.idx = g.idx
    )
  INTO v_total, v_pending_ack, v_approved, v_rejected, v_by_type, v_by_status, v_volume;

  RETURN jsonb_build_object(
    'ok', true,
    'total', COALESCE(v_total, 0),
    'pending_ack', COALESCE(v_pending_ack, 0),
    'approved', COALESCE(v_approved, 0),
    'rejected', COALESCE(v_rejected, 0),
    'by_type', COALESCE(v_by_type, '{}'::jsonb),
    'by_status', COALESCE(v_by_status, '{}'::jsonb),
    'volume', COALESCE(v_volume, '[]'::jsonb)
  );
END;
$function$;

-- A new function inherits PUBLIC EXECUTE. The in-body staff gate already refuses
-- a rider, so this block is about not advertising the function to `anon`/a rider
-- session in the first place. Re-apply after any future DROP + recreate, since
-- only CREATE OR REPLACE preserves an ACL.
REVOKE ALL ON FUNCTION public.admin_requests_trend(
  timestamptz, timestamptz, text, text, text, uuid, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requests_trend(
  timestamptz, timestamptz, text, text, text, uuid, text, integer
) TO authenticated;
