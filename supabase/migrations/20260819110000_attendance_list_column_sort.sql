-- Column click-to-sort for attendance daily list (asc/desc per column).

CREATE OR REPLACE FUNCTION public.admin_list_attendance_daily(
  p_from date,
  p_to date,
  p_search text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL,
  p_restaurant_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_live_only boolean DEFAULT false,
  p_sort text DEFAULT 'problems_first',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_total integer;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH filtered AS (
    SELECT v.*
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
      AND (NOT p_live_only OR v.log_date = (now() AT TIME ZONE 'Asia/Kuwait')::date)
      AND (p_partner_id IS NULL OR v.partner_id = p_partner_id)
      AND (p_zone_id IS NULL OR v.zone_id = p_zone_id)
      AND (
        p_restaurant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.driver_restaurants dr
          WHERE dr.driver_id = v.driver_id AND dr.restaurant_id = p_restaurant_id
        )
      )
      AND (
        p_status IS NULL
        OR p_status = 'all'
        OR (p_status = 'scheduled' AND v.live_status = 'scheduled')
        OR (p_status = 'checked_in' AND v.check_in_at IS NOT NULL)
        OR (p_status = 'late' AND v.minutes_late > 0)
        OR (p_status = 'absent' AND v.live_status = 'absent')
        OR (p_status = 'online' AND v.is_on_duty AND v.live_status = 'on_duty')
        OR (p_status = 'problems' AND v.live_status IN (
          'late', 'absent', 'offline_during_shift', 'gps_stale', 'outside_zone'
        ))
        OR v.live_status = p_status
      )
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR v.driver_name ILIKE '%' || btrim(p_search) || '%'
        OR v.driver_code ILIKE '%' || btrim(p_search) || '%'
        OR v.employee_id ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::integer AS total FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered f
    ORDER BY
      CASE p_sort
        WHEN 'problems_first' THEN
          CASE f.live_status
            WHEN 'late' THEN 1
            WHEN 'offline_during_shift' THEN 2
            WHEN 'gps_stale' THEN 3
            WHEN 'outside_zone' THEN 4
            WHEN 'absent' THEN 5
            ELSE 10
          END
        ELSE 0
      END,
      CASE WHEN p_sort IN ('problems_first', 'date_desc') THEN f.log_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'date_asc' THEN f.log_date END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_asc' THEN f.driver_name END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_desc' THEN f.driver_name END DESC NULLS LAST,
      CASE WHEN p_sort IN ('last_seen', 'last_seen_desc') THEN f.last_seen_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'last_seen_asc' THEN f.last_seen_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'status_asc' THEN f.live_status END ASC NULLS LAST,
      CASE WHEN p_sort = 'status_desc' THEN f.live_status END DESC NULLS LAST,
      CASE WHEN p_sort = 'check_in_asc' THEN f.check_in_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'check_in_desc' THEN f.check_in_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'check_out_asc' THEN f.check_out_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'check_out_desc' THEN f.check_out_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'duty_seconds_asc' THEN f.duty_seconds END ASC NULLS LAST,
      CASE WHEN p_sort = 'duty_seconds_desc' THEN f.duty_seconds END DESC NULLS LAST,
      CASE WHEN p_sort = 'on_duty_asc' THEN f.is_on_duty::integer END ASC NULLS LAST,
      CASE WHEN p_sort = 'on_duty_desc' THEN f.is_on_duty::integer END DESC NULLS LAST,
      f.driver_name ASC
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    (SELECT total FROM counted),
    COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  INTO v_total, v_rows
  FROM paged p;

  RETURN jsonb_build_object(
    'totalCount', COALESCE(v_total, 0),
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_attendance_daily(date, date, text, uuid, uuid, uuid, text, boolean, text, integer, integer) TO authenticated;
