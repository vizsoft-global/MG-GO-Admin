-- A straight line across the city is not a route.
--
-- `admin_get_driver_day_route` drew the day as one polyline through every kept fix and
-- summed every segment that did not imply more than 40 m/s. Both are wrong in the same
-- way: they treat "the next fix we have" as "where the rider went next".
--
-- The 40 m/s test only catches a teleport between two fixes taken seconds apart. When
-- reporting *stops* — app killed, phone dead, no signal — the next fix arrives minutes or
-- hours later, so the implied speed is perfectly ordinary and the segment sails through.
-- One rider in production today has a 29.4 km segment spanning 4.6 hours (1.8 m/s) and
-- another a 6.6 km segment over 9 minutes (12 m/s). Neither describes travel that was
-- observed; they describe the two ends of a hole.
--
-- The length of the segment is what gives it away. History is written at >= 75m spacing
-- while a rider moves (p50 today is 90m across the fleet, p90 is 197m), so two consecutive
-- fixes a kilometre apart mean roughly a dozen rows that were never written. 500m is
-- therefore the threshold, and it is not a new number: it is the same
-- `v_segment_m > 500` guard both odometer writers already apply. Adding it here is what
-- finally makes true the claim in their comments that the route and the odometer agree
-- about what counts as travel — replayed over today's fleet, the sampled sum lands within
-- a few percent of the independently-maintained odometer on every driver, where before it
-- read 24.05 km against 5.83, 22.20 against 6.71 and 36.83 against 27.79. A 300m
-- threshold was measured too and overshoots (2.59 km against the same 5.83), because the
-- edge rail's durable-write grace legitimately coarsens spacing to a few hundred metres.
--
-- Excluded distance is *reported*, not silently dropped: `gap_distance_m`, `gap_seconds`
-- and `gap_count` are returned so the strip can say how much of the day it cannot account
-- for. A number that is quietly short is the same failure as one that is quietly long.
--
-- Each returned point also carries `gap_before`, so the client can draw the connector as
-- a dashed grey line rather than a route. The flag is computed on the *raw* series and
-- then folded onto the simplified one: ST_Simplify legitimately removes collinear fixes
-- along a straight road, so a long drawn segment is not by itself evidence of a hole —
-- only a jump among the raw fixes it replaced is.

CREATE OR REPLACE FUNCTION public.admin_get_driver_day_route(
  p_driver_id uuid,
  p_date date DEFAULT NULL,
  p_tolerance_m numeric DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_day date := COALESCE(p_date, v_today);
  v_from timestamptz := (v_day::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_to timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_tolerance double precision := GREATEST(COALESCE(p_tolerance_m, 8), 0)::double precision;
  v_odometer numeric;
  v_result jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'driver_id_required';
  END IF;

  IF v_day = v_today THEN
    SELECT dl.distance_today_meters
    INTO v_odometer
    FROM public.driver_locations dl
    WHERE dl.driver_id = p_driver_id
      AND (dl.last_seen_at AT TIME ZONE 'Asia/Kuwait')::date = v_today;
  END IF;

  WITH pts AS (
    SELECT
      row_number() OVER (ORDER BY e.recorded_at, e.id) AS idx,
      e.latitude, e.longitude, e.speed_mps, e.battery_pct, e.accuracy_meters,
      e.heading_deg, e.tracking_status, e.zone_status, e.active_delivery_id,
      e.recorded_at
    FROM public.driver_location_events e
    WHERE e.driver_id = p_driver_id
      AND e.recorded_at >= v_from
      AND e.recorded_at < v_to
      -- A coarse fix is a claim about a cell tower, not about the rider.
      AND (e.accuracy_meters IS NULL OR e.accuracy_meters <= 50)
  ),
  stats AS (
    SELECT
      count(*) AS total,
      COALESCE(extract(epoch FROM (max(recorded_at) - min(recorded_at))), 0) AS duration_s
    FROM pts
  ),
  -- Every segment of the *full* series, with the time it spans.
  seg AS (
    SELECT
      idx,
      lag(idx) OVER w IS NOT NULL AS has_prev,
      public._haversine_meters(
        lag(latitude::double precision) OVER w,
        lag(longitude::double precision) OVER w,
        latitude::double precision,
        longitude::double precision
      ) AS meters,
      GREATEST(
        extract(epoch FROM (recorded_at - lag(recorded_at) OVER w)),
        0.001
      ) AS gap_s
    FROM pts
    WINDOW w AS (ORDER BY idx)
  ),
  -- A segment is travel only if the path between its ends was actually observed.
  -- >40 m/s is a glitch; >500m is a hole in the reporting, whatever speed it implies.
  flagged AS (
    SELECT
      idx, meters, gap_s, has_prev,
      (has_prev AND (meters > 500 OR meters / gap_s > 40)) AS is_jump
    FROM seg
  ),
  -- Running jump count, so folding jumps onto the simplified series below stays a
  -- single pass instead of a scan per kept point.
  running AS (
    SELECT
      idx, meters, gap_s, has_prev, is_jump,
      sum(CASE WHEN is_jump THEN 1 ELSE 0 END) OVER (ORDER BY idx) AS jumps_so_far
    FROM flagged
  ),
  dist AS (
    SELECT
      COALESCE(sum(meters) FILTER (WHERE has_prev AND NOT is_jump), 0) AS distance_m,
      COALESCE(sum(meters) FILTER (WHERE is_jump), 0) AS gap_distance_m,
      COALESCE(sum(gap_s) FILTER (WHERE is_jump), 0) AS gap_seconds,
      count(*) FILTER (WHERE is_jump) AS gap_count
    FROM running
  ),
  line AS (
    SELECT ST_Simplify(
      ST_Transform(
        ST_SetSRID(
          ST_MakeLine(
            ST_MakePointM(longitude::double precision, latitude::double precision, idx)
            ORDER BY idx
          ),
          4326
        ),
        32639  -- UTM 39N: metric, and Kuwait sits inside it
      ),
      v_tolerance
    ) AS g
    FROM pts
    WHERE (SELECT total FROM stats) >= 3 AND v_tolerance > 0
  ),
  kept AS (
    SELECT DISTINCT ST_M((dp).geom)::bigint AS idx
    FROM line, ST_DumpPoints(line.g) AS dp
    UNION
    -- Too short to simplify, or simplification switched off: keep everything.
    SELECT idx FROM pts WHERE (SELECT total FROM stats) < 3 OR v_tolerance <= 0
  ),
  kept_ordered AS (
    SELECT
      p.*,
      r.jumps_so_far,
      lag(r.jumps_so_far) OVER (ORDER BY p.idx) AS prev_jumps
    FROM pts p
    JOIN kept k ON k.idx = p.idx
    JOIN running r ON r.idx = p.idx
  ),
  kept_points AS (
    SELECT
      idx, latitude, longitude, speed_mps, battery_pct, accuracy_meters,
      heading_deg, tracking_status, zone_status, active_delivery_id, recorded_at,
      -- True when at least one jump was swallowed between the previous kept point
      -- and this one, so the connector must not be drawn as a travelled path.
      COALESCE(jumps_so_far > prev_jumps, false) AS gap_before
    FROM kept_ordered
  ),
  -- A stop is a run of fixes inside 60m spanning at least 3 minutes.
  marked AS (
    SELECT
      idx, latitude, longitude, recorded_at,
      CASE
        WHEN lag(latitude) OVER (ORDER BY idx) IS NULL THEN 1
        WHEN public._haversine_meters(
               lag(latitude::double precision) OVER (ORDER BY idx),
               lag(longitude::double precision) OVER (ORDER BY idx),
               latitude::double precision,
               longitude::double precision
             ) > 60 THEN 1
        ELSE 0
      END AS is_break
    FROM pts
  ),
  grouped AS (
    SELECT marked.*, sum(is_break) OVER (ORDER BY idx) AS grp FROM marked
  ),
  runs AS (
    SELECT
      round(avg(latitude), 6) AS latitude,
      round(avg(longitude), 6) AS longitude,
      min(recorded_at) AS arrived_at,
      max(recorded_at) AS departed_at,
      count(*) AS fixes,
      extract(epoch FROM (max(recorded_at) - min(recorded_at)))::integer AS seconds
    FROM grouped
    GROUP BY grp
    HAVING extract(epoch FROM (max(recorded_at) - min(recorded_at))) >= 180
  ),
  dels AS (
    SELECT dv.id AS delivery_id, dv.external_order_id, dv.status::text AS status,
           'pickup' AS kind, dv.pickup_lat AS latitude, dv.pickup_lng AS longitude,
           dv.pickup_at AS at, r.name AS restaurant_name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.pickup_at >= v_from AND dv.pickup_at < v_to
      AND dv.pickup_lat IS NOT NULL AND dv.pickup_lng IS NOT NULL
    UNION ALL
    SELECT dv.id, dv.external_order_id, dv.status::text,
           'delivered', dv.delivered_lat, dv.delivered_lng, dv.delivered_at, r.name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.delivered_at >= v_from AND dv.delivered_at < v_to
      AND dv.delivered_lat IS NOT NULL AND dv.delivered_lng IS NOT NULL
    UNION ALL
    SELECT dv.id, dv.external_order_id, dv.status::text,
           'cancelled', dv.cancel_lat, dv.cancel_lng, dv.cancelled_at, r.name
    FROM public.deliveries dv
    LEFT JOIN public.restaurants r ON r.id = dv.restaurant_id
    WHERE dv.driver_id = p_driver_id
      AND dv.cancelled_at >= v_from AND dv.cancelled_at < v_to
      AND dv.cancel_lat IS NOT NULL AND dv.cancel_lng IS NOT NULL
  )
  SELECT jsonb_build_object(
    'driver_id', p_driver_id,
    'date', v_day,
    'from', v_from,
    'to', v_to,
    'points', COALESCE(
      (SELECT jsonb_agg(to_jsonb(kp) ORDER BY kp.idx) FROM kept_points kp), '[]'::jsonb
    ),
    'stops', COALESCE(
      (SELECT jsonb_agg(to_jsonb(rn) ORDER BY rn.arrived_at) FROM runs rn), '[]'::jsonb
    ),
    'deliveries', COALESCE(
      (SELECT jsonb_agg(to_jsonb(dd) ORDER BY dd.at) FROM dels dd), '[]'::jsonb
    ),
    -- One number per day, shared with the driver card. The sampled figure is a
    -- 75m-spaced polyline and reads low on a winding route, so it is not what the
    -- panel shows for today — but it is still returned, because it is the only
    -- distance that exists for a past day and the only one the drawn line supports.
    'distance_m', COALESCE(round(v_odometer, 2), round(dist.distance_m::numeric, 2)),
    'sampled_distance_m', round(dist.distance_m::numeric, 2),
    'distance_source', CASE WHEN v_odometer IS NULL THEN 'sampled' ELSE 'odometer' END,
    -- What the day cannot account for. Reported rather than dropped, so a short
    -- number is visibly short.
    'gap_distance_m', round(dist.gap_distance_m::numeric, 2),
    'gap_seconds', round(dist.gap_seconds::numeric, 0),
    'gap_count', dist.gap_count,
    'duration_s', round(stats.duration_s::numeric, 0),
    'point_count', stats.total,
    'kept_count', (SELECT count(*) FROM kept_points)
  )
  INTO v_result
  FROM stats, dist;

  RETURN v_result;
END;
$$;
