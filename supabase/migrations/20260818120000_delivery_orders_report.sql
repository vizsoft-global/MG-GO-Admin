-- Delivery Orders Report: per-driver per-shift-day delivery counts with overnight shift attribution.

CREATE OR REPLACE FUNCTION public.report_delivery_orders(
  p_from date,
  p_to date
)
RETURNS TABLE (
  driver_id uuid,
  driver_code text,
  employee_id text,
  full_name text,
  store_name text,
  shift_date date,
  delivery_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_shift_from date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  v_from_ts := (p_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_to_ts := ((p_to + 2)::timestamp + time '23:59:59.999') AT TIME ZONE 'Asia/Kuwait';
  v_shift_from := p_from - 1;

  RETURN QUERY
  WITH shift_windows AS (
    SELECT
      s.driver_id,
      s.shift_date,
      public.shift_session_instant(s.shift_date, s.session1_start, 0) AS window_start,
      public.shift_session_instant(
        s.shift_date,
        s.session1_end,
        s.session1_end_day_offset
      ) AS window_end
    FROM public.driver_daily_shifts s
    WHERE s.shift_date BETWEEN v_shift_from AND p_to

    UNION ALL

    SELECT
      s.driver_id,
      s.shift_date,
      public.shift_session_instant(
        s.shift_date,
        s.session2_start,
        s.session2_start_day_offset
      ) AS window_start,
      public.shift_session_instant(
        s.shift_date,
        s.session2_end,
        s.session2_end_day_offset
      ) AS window_end
    FROM public.driver_daily_shifts s
    WHERE s.shift_type = 'split'
      AND s.session2_start IS NOT NULL
      AND s.session2_end IS NOT NULL
      AND s.shift_date BETWEEN v_shift_from AND p_to
  ),
  candidate_deliveries AS (
    SELECT
      d.id,
      d.driver_id,
      d.delivered_at
    FROM public.deliveries d
    WHERE d.delivered_at IS NOT NULL
      AND d.delivered_at >= v_from_ts
      AND d.delivered_at <= v_to_ts
      AND d.status NOT IN ('rejected', 'cancelled')
  ),
  attributed AS (
    SELECT
      cd.id,
      cd.driver_id,
      COALESCE(
        (
          SELECT sw.shift_date
          FROM shift_windows sw
          WHERE sw.driver_id = cd.driver_id
            AND cd.delivered_at >= sw.window_start
            AND cd.delivered_at < sw.window_end
          ORDER BY sw.window_start
          LIMIT 1
        ),
        (
          SELECT sw.shift_date
          FROM shift_windows sw
          WHERE sw.driver_id = cd.driver_id
            AND sw.window_start <= cd.delivered_at
          ORDER BY sw.window_start DESC
          LIMIT 1
        ),
        (
          SELECT sw.shift_date
          FROM shift_windows sw
          WHERE sw.driver_id = cd.driver_id
          ORDER BY ABS(EXTRACT(EPOCH FROM (cd.delivered_at - sw.window_start)))
          LIMIT 1
        ),
        (cd.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
      ) AS attributed_date
    FROM candidate_deliveries cd
  ),
  aggregated AS (
    SELECT
      a.driver_id,
      a.attributed_date AS shift_date,
      COUNT(*)::bigint AS delivery_count
    FROM attributed a
    WHERE a.attributed_date BETWEEN p_from AND p_to
    GROUP BY a.driver_id, a.attributed_date
  )
  SELECT
    agg.driver_id,
    dr.driver_code,
    dr.employee_id,
    COALESCE(p.full_name, '—') AS full_name,
    COALESCE(
      (
        SELECT MIN(r.name)
        FROM public.driver_restaurants drs
        JOIN public.restaurants r ON r.id = drs.restaurant_id
        WHERE drs.driver_id = agg.driver_id
          AND r.status = 'published'
      ),
      '—'
    ) AS store_name,
    agg.shift_date,
    agg.delivery_count
  FROM aggregated agg
  JOIN public.drivers dr ON dr.id = agg.driver_id
  LEFT JOIN public.profiles p ON p.id = dr.id
  ORDER BY p.full_name ASC NULLS LAST, agg.shift_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_delivery_orders(date, date) TO authenticated;

COMMENT ON FUNCTION public.report_delivery_orders(date, date) IS
  'Per-driver per-shift-day delivery counts for the Orders Report matrix export. Attributes deliveries to submitted shift windows; falls back to nearest shift or Kuwait calendar day.';
