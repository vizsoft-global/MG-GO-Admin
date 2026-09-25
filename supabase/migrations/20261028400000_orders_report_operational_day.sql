-- Orders Report: when From time is not 00:00, columns are operational days
-- starting at that clock. 05:00 → next-day 05:00 does not split at midnight.
-- Equal from/to times use an exclusive end so the next-day 05:00 belongs to
-- the next report. Default 00:00 keeps existing shift attribution.

CREATE OR REPLACE FUNCTION public.report_delivery_orders(
  p_from date,
  p_to date,
  p_from_time time DEFAULT '00:00:00',
  p_to_time time DEFAULT '23:59:00'
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
  v_from_clock time := COALESCE(p_from_time, time '00:00:00');
  v_to_clock time := COALESCE(p_to_time, time '23:59:00');
  v_operational boolean := v_from_clock <> time '00:00:00';
  v_exclusive_end boolean := v_operational AND v_from_clock = v_to_clock;
  v_col_from date;
  v_col_to date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF p_from = p_to AND v_from_clock > v_to_clock THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF (p_to - p_from) + 1 > 366 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_from_ts := (p_from::timestamp + v_from_clock) AT TIME ZONE 'Asia/Kuwait';

  IF v_exclusive_end THEN
    v_to_ts := (p_to::timestamp + v_to_clock) AT TIME ZONE 'Asia/Kuwait';
  ELSE
    v_to_ts := (
      (p_to::timestamp + v_to_clock + interval '1 minute') AT TIME ZONE 'Asia/Kuwait'
    ) - interval '1 millisecond';
  END IF;

  IF v_from_ts > v_to_ts OR (v_exclusive_end AND v_from_ts >= v_to_ts) THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;

  IF v_operational THEN
    v_col_from := p_from;
    IF v_to_clock <= v_from_clock AND p_to > p_from THEN
      v_col_to := p_to - 1;
    ELSE
      v_col_to := p_to;
    END IF;

    RETURN QUERY
    WITH candidate_deliveries AS MATERIALIZED (
      SELECT
        d.id,
        d.driver_id,
        d.delivered_at,
        LEAST(
          GREATEST(
            ((d.delivered_at AT TIME ZONE 'Asia/Kuwait') - v_from_clock)::date,
            v_col_from
          ),
          v_col_to
        ) AS attributed_date
      FROM public.deliveries d
      WHERE d.delivered_at IS NOT NULL
        AND d.delivered_at >= v_from_ts
        AND (
          (v_exclusive_end AND d.delivered_at < v_to_ts)
          OR (NOT v_exclusive_end AND d.delivered_at <= v_to_ts)
        )
        AND d.status NOT IN ('rejected', 'cancelled')
    ),
    aggregated AS (
      SELECT
        cd.driver_id,
        cd.attributed_date AS shift_date,
        COUNT(*)::bigint AS delivery_count
      FROM candidate_deliveries cd
      GROUP BY cd.driver_id, cd.attributed_date
    ),
    driver_stores AS MATERIALIZED (
      SELECT
        drs.driver_id,
        MIN(r.name) AS store_name
      FROM public.driver_restaurants drs
      JOIN public.restaurants r ON r.id = drs.restaurant_id
      WHERE r.status = 'published'
      GROUP BY drs.driver_id
    )
    SELECT
      agg.driver_id,
      dr.driver_code,
      dr.employee_id,
      COALESCE(p.full_name, '—') AS full_name,
      COALESCE(ds.store_name, '—') AS store_name,
      agg.shift_date,
      agg.delivery_count
    FROM aggregated agg
    JOIN public.drivers dr ON dr.id = agg.driver_id
    LEFT JOIN public.profiles p ON p.id = dr.id
    LEFT JOIN driver_stores ds ON ds.driver_id = agg.driver_id
    ORDER BY p.full_name ASC NULLS LAST, agg.shift_date ASC;

    RETURN;
  END IF;

  v_shift_from := p_from - 1;

  RETURN QUERY
  WITH shift_windows AS MATERIALIZED (
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
  candidate_deliveries AS MATERIALIZED (
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
  matched_in_window AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
     AND cd.delivered_at >= sw.window_start
     AND cd.delivered_at < sw.window_end
    ORDER BY cd.id, sw.window_start
  ),
  matched_prev AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
     AND sw.window_start <= cd.delivered_at
    WHERE NOT EXISTS (
      SELECT 1 FROM matched_in_window m WHERE m.id = cd.id
    )
    ORDER BY cd.id, sw.window_start DESC
  ),
  matched_nearest AS MATERIALIZED (
    SELECT DISTINCT ON (cd.id)
      cd.id,
      sw.shift_date
    FROM candidate_deliveries cd
    JOIN shift_windows sw
      ON sw.driver_id = cd.driver_id
    WHERE NOT EXISTS (
      SELECT 1 FROM matched_in_window m WHERE m.id = cd.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM matched_prev p WHERE p.id = cd.id
      )
    ORDER BY cd.id, ABS(EXTRACT(EPOCH FROM (cd.delivered_at - sw.window_start)))
  ),
  attributed AS MATERIALIZED (
    SELECT
      cd.driver_id,
      COALESCE(
        iw.shift_date,
        pw.shift_date,
        nw.shift_date,
        (cd.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
      ) AS attributed_date
    FROM candidate_deliveries cd
    LEFT JOIN matched_in_window iw ON iw.id = cd.id
    LEFT JOIN matched_prev pw ON pw.id = cd.id
    LEFT JOIN matched_nearest nw ON nw.id = cd.id
  ),
  aggregated AS (
    SELECT
      a.driver_id,
      a.attributed_date AS shift_date,
      COUNT(*)::bigint AS delivery_count
    FROM attributed a
    WHERE a.attributed_date BETWEEN p_from AND p_to
    GROUP BY a.driver_id, a.attributed_date
  ),
  driver_stores AS MATERIALIZED (
    SELECT
      drs.driver_id,
      MIN(r.name) AS store_name
    FROM public.driver_restaurants drs
    JOIN public.restaurants r ON r.id = drs.restaurant_id
    WHERE r.status = 'published'
    GROUP BY drs.driver_id
  )
  SELECT
    agg.driver_id,
    dr.driver_code,
    dr.employee_id,
    COALESCE(p.full_name, '—') AS full_name,
    COALESCE(ds.store_name, '—') AS store_name,
    agg.shift_date,
    agg.delivery_count
  FROM aggregated agg
  JOIN public.drivers dr ON dr.id = agg.driver_id
  LEFT JOIN public.profiles p ON p.id = dr.id
  LEFT JOIN driver_stores ds ON ds.driver_id = agg.driver_id
  ORDER BY p.full_name ASC NULLS LAST, agg.shift_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.report_delivery_orders(date, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_delivery_orders(date, date, time, time) TO authenticated;

COMMENT ON FUNCTION public.report_delivery_orders(date, date, time, time) IS
  'Orders Report counts. From 00:00 uses shift attribution. Any other From time uses an operational day from that clock; equal from/to times are exclusive at the end so the next-day boundary starts the next report. Max 366 inclusive days.';
