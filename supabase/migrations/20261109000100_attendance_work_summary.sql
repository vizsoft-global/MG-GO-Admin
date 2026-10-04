-- QA #1 — Attendance said "0/25 days completed" while Earnings said "100% attendance,
-- 7 working days" for the same month.
--
-- Three independent defects produced the disagreement:
--
-- (a) `driver_get_attendance.present_days` counted only `status = 'present'`.
--     A day only becomes `present` when the rider is zone/range validated; a rider
--     who worked a full month but was never validated keeps `online_unvalidated`
--     rows (the grid still shows their hours). Every such month read as 0 present.
--     A logged-on day is a completed day, so present_days now counts both
--     `present` and `online_unvalidated`.
--
-- (b) The Earnings performance card asked `driver_get_attendance` for a
--     `summary.attendance_pct` key that never existed and silently fell back to
--     a hard-coded 100. The RPC now returns `attendance_pct` computed from
--     present/elapsed, so the two screens read one number.
--
-- (c) Working days counted *lifetime* distinct delivery days (the query had no
--     month filter and read the whole history). A new month-scoped
--     `driver_get_work_summary(year, month)` returns working days for that month,
--     attributed by `shift_date` with the same calendar fallback the DPD counters
--     use, so a midnight shift's orders count on the shift's day.
--
-- Additive: `driver_get_attendance` gains `attendance_pct` and only widens its
-- present-day predicate; the existing keys and rows are unchanged. No table,
-- column, RLS policy, grant or index is touched.

-- ---------------------------------------------------------------------------
-- driver_get_attendance — completed days include online_unvalidated; add pct
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_get_attendance(
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_elapsed integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_present integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  IF v_today < v_start THEN
    v_elapsed := 0;
  ELSIF v_today > v_end THEN
    v_elapsed := extract(day FROM v_end)::integer;
  ELSE
    v_elapsed := extract(day FROM v_today)::integer;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'attendance_date', da.attendance_date,
        'online_seconds', da.online_seconds
          + CASE
            WHEN ds.is_online = true
              AND da.attendance_date = v_today
              AND da.last_online_at IS NOT NULL
            THEN GREATEST(0, extract(epoch FROM ((now()) - da.last_online_at))::integer)
            ELSE 0
          END,
        'status', da.status,
        'is_validated', da.is_validated,
        'validation_source', da.validation_source,
        'shift_adherence', public._driver_shift_adherence(v_uid, da.attendance_date)
      )
      ORDER BY da.attendance_date
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.driver_attendance da
  LEFT JOIN LATERAL (
    SELECT s.is_online
    FROM public.driver_sessions s
    WHERE s.driver_id = da.driver_id
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) ds ON true
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND v_end;

  -- A day the rider logged on is a completed day even when it was never zone/range
  -- validated; that is what the grid already shows (hours on an online_unvalidated row).
  SELECT count(*)::integer
  INTO v_present
  FROM public.driver_attendance da
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND LEAST(v_end, v_today)
    AND da.status IN ('present', 'online_unvalidated');

  RETURN jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'present_days', v_present,
    'elapsed_days', v_elapsed,
    'attendance_pct',
      CASE WHEN v_elapsed > 0
        THEN LEAST(100, round(v_present::numeric / v_elapsed::numeric * 100)::integer)
        ELSE 0
      END,
    'rows', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- driver_get_work_summary — month-scoped working days + attendance %, one call
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_get_work_summary(
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_elapsed integer := 0;
  v_present integer := 0;
  v_working_days integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_year IS NULL OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  IF v_today < v_start THEN
    v_elapsed := 0;
  ELSIF v_today > v_end THEN
    v_elapsed := extract(day FROM v_end)::integer;
  ELSE
    v_elapsed := extract(day FROM v_today)::integer;
  END IF;

  SELECT count(*)::integer
  INTO v_present
  FROM public.driver_attendance da
  WHERE da.driver_id = v_uid
    AND da.attendance_date BETWEEN v_start AND LEAST(v_end, v_today)
    AND da.status IN ('present', 'online_unvalidated');

  -- Distinct days with at least one non-cancelled delivery in this month, attributed by
  -- shift_date (a 14:00-02:00 shift's post-midnight orders belong to the shift day), with
  -- the Kuwait calendar day as the fallback for a legacy NULL shift_date row.
  SELECT count(DISTINCT COALESCE(
           d.shift_date,
           (COALESCE(d.delivered_at, d.pickup_at) AT TIME ZONE 'Asia/Kuwait')::date
         ))::integer
  INTO v_working_days
  FROM public.deliveries d
  WHERE d.driver_id = v_uid
    AND d.status IS DISTINCT FROM 'cancelled'::public.delivery_status
    AND (
      d.shift_date BETWEEN v_start AND v_end
      OR (
        d.shift_date IS NULL
        AND (COALESCE(d.delivered_at, d.pickup_at) AT TIME ZONE 'Asia/Kuwait')::date
              BETWEEN v_start AND v_end
      )
    );

  RETURN jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'present_days', v_present,
    'elapsed_days', v_elapsed,
    'working_days', COALESCE(v_working_days, 0),
    'attendance_pct',
      CASE WHEN v_elapsed > 0
        THEN LEAST(100, round(v_present::numeric / v_elapsed::numeric * 100)::integer)
        ELSE 0
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_get_work_summary(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_get_work_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_work_summary(integer, integer) TO service_role;

COMMENT ON FUNCTION public.driver_get_work_summary(integer, integer) IS
  'Rider: month-scoped working days (distinct shift days with a non-cancelled delivery) and attendance % for the Earnings performance card. present_days counts logged-on days (present or online_unvalidated).';
