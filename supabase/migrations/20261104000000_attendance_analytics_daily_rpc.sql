-- P4 / pending-P1: the /attendance Analytics tab was the one remaining
-- unbounded read on the attendance hub.
--
-- Daily and History were already server-side paginated (`p_limit` / `p_offset`
-- on `admin_list_attendance_daily`, PAGE_SIZE = 50), but the Analytics summary
-- did `select(...).gte('log_date').lte('log_date')` against `v_attendance_daily`
-- with no limit and then bucketed every driver-day row in JavaScript. A single
-- month returns 9,669 rows / 1,660,946 bytes for a panel whose entire output is
-- one line per day (~30 rows).
--
-- This adds a day-grain aggregate so the client receives at most one row per
-- day for any range. Semantics are preserved exactly from
-- `fetchAttendanceAnalyticsSummary`:
--   checked_in      = rows with check_in_at IS NOT NULL
--   late            = rows with COALESCE(minutes_late, 0) > 0
--   absent          = rows with live_status = 'absent'
--   avg_compliance  = round(avg(compliance_score)) over non-null scores, else 0
--   days (client)   = count of dates that have at least one row, i.e. the
--                     number of groups produced here
-- Dates are emitted in ascending order, matching the previous client-side
-- `localeCompare` sort on 'YYYY-MM-DD'.

CREATE OR REPLACE FUNCTION public.admin_attendance_analytics_daily(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_daily jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', d.log_date,
        'checked_in', d.checked_in,
        'late', d.late,
        'absent', d.absent,
        'avg_compliance', d.avg_compliance
      )
      ORDER BY d.log_date
    ),
    '[]'::jsonb
  )
  INTO v_daily
  FROM (
    SELECT
      v.log_date,
      count(*) FILTER (WHERE v.check_in_at IS NOT NULL)::integer AS checked_in,
      count(*) FILTER (WHERE COALESCE(v.minutes_late, 0) > 0)::integer AS late,
      count(*) FILTER (WHERE v.live_status = 'absent')::integer AS absent,
      COALESCE(round(avg(v.compliance_score))::integer, 0) AS avg_compliance
    FROM public.v_attendance_daily v
    WHERE v.log_date BETWEEN p_from AND p_to
    GROUP BY v.log_date
  ) d;

  RETURN jsonb_build_object('daily', v_daily);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_attendance_analytics_daily(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_attendance_analytics_daily(date, date) TO authenticated;
