-- P1: remove the last two full scans behind the panel's hottest paths.
--
-- 1. `admin_live_fleet_snapshot` is the single most-executed expensive statement in the
--    database: 784,364 calls at a 313 ms mean, ~68 hours of database time. Its two per-driver
--    day counters tested `(created_at AT TIME ZONE 'Asia/Kuwait')::date = v_day`, which is not
--    sargable, so each call read and discarded roughly 200 deliveries per driver -- 180,948
--    rows for the fleet, measured at 689 ms just for the four correlated subqueries -- to
--    return the 4 rows that were actually today's. Rewriting the predicate as the exactly
--    equivalent `[v_day 00:00, v_day+1 00:00)` timestamptz range lets the same index
--    range-scan only today's rows. Asia/Kuwait is a fixed UTC+3 offset with no DST, so the
--    range and the AT TIME ZONE expression select precisely the same set of rows.
--
--    `deliveries_driver_created_at_idx` is what makes the first counter's range scan possible;
--    the second counter already had `(driver_id, delivered_at)` and only needed the predicate
--    to become a range.
--
-- 2. The deliveries list filters by `zone_id` / `partner_id`, and neither column had an index,
--    so those filters fell back to a Parallel Seq Scan of all 184,300 rows with a Sort on top
--    -- measured at 38.193 ms and 8,944 buffers for one page of 50. Only 1,981 deliveries
--    carry a zone and 66 carry a partner, so the supporting indexes are partial and tiny,
--    which also keeps them cheap to maintain on the delivery insert path.
--
-- Both changes are index/predicate only. No filter, ordering, pagination, RLS, permission or
-- returned column changes, and the deliveries list query itself is untouched.

CREATE INDEX IF NOT EXISTS deliveries_driver_created_at_idx
  ON public.deliveries USING btree (driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deliveries_zone_created_at_idx
  ON public.deliveries USING btree (zone_id, created_at DESC, id DESC)
  WHERE zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deliveries_partner_created_at_idx
  ON public.deliveries USING btree (partner_id, created_at DESC, id DESC)
  WHERE partner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_live_fleet_snapshot(p_seen_within_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_day_start timestamptz := ((v_now AT TIME ZONE 'Asia/Kuwait')::date::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_day_end timestamptz := (((v_now AT TIME ZONE 'Asia/Kuwait')::date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_cutoff timestamptz;
  v_drivers jsonb;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cutoff := v_now - make_interval(mins => GREATEST(COALESCE(p_seen_within_minutes, 30), 1));

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_seen_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_drivers
  FROM (
    SELECT
      d.id AS driver_id,
      COALESCE(NULLIF(trim(p.full_name), ''), d.driver_code) AS driver_name,
      d.driver_code,
      d.employee_id,
      d.avatar_object_key,
      d.avatar_updated_at,
      p.avatar_url,
      p.phone,
      d.status::text AS account_status,
      d.is_on_duty,
      (d.is_blocked OR public.driver_freeze_is_active(d.frozen_from, d.frozen_until)) AS is_blocked,
      d.zone_id,
      z.name AS zone_name,
      z.color AS zone_color,
      d.partner_id,
      pa.name AS partner_name,
      d.restaurant_id,
      r.name AS restaurant_name,
      d.vehicle_id,
      v.reg_number AS vehicle_reg_number,
      v.bike_id AS vehicle_bike_id,
      COALESCE(v.vehicle_type_key, d.vehicle_type_key, 'bike') AS vehicle_type_key,
      dl.latitude,
      dl.longitude,
      dl.speed_mps,
      dl.heading_deg,
      dl.accuracy_meters,
      dl.battery_pct,
      dl.is_mocked,
      dl.tracking_status,
      dl.zone_status,
      dl.out_of_zone_since,
      dl.distance_today_meters,
      open_delivery.id AS active_delivery_id,
      dl.last_seen_at,
      dl.last_report_at,
      EXISTS (
        SELECT 1 FROM public.driver_sessions ds
        WHERE ds.driver_id = d.id AND ds.is_online
      ) AS is_online,
      (
        SELECT al.check_in_at
        FROM public.attendance_logs al
        WHERE al.driver_id = d.id AND al.log_date = v_day
        ORDER BY al.check_in_at DESC NULLS LAST
        LIMIT 1
      ) AS on_duty_since,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.status <> 'cancelled'
          AND dv.created_at >= v_day_start
          AND dv.created_at < v_day_end
      ) AS deliveries_today,
      (
        SELECT count(*)
        FROM public.deliveries dv
        WHERE dv.driver_id = d.id
          AND dv.delivered_at >= v_day_start
          AND dv.delivered_at < v_day_end
      ) AS deliveries_completed_today,
      sh.shift
    FROM public.drivers d
    JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.driver_locations dl ON dl.driver_id = d.id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    LEFT JOIN public.partners pa ON pa.id = d.partner_id
    LEFT JOIN public.restaurants r ON r.id = d.restaurant_id
    LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
    LEFT JOIN LATERAL (
      SELECT dv.id
      FROM public.deliveries dv
      WHERE dv.driver_id = d.id
        AND dv.status = 'in_transit'
      ORDER BY dv.pickup_at DESC NULLS LAST, dv.created_at DESC
      LIMIT 1
    ) open_delivery ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'shift_date', s.shift_date,
        'shift_type', s.shift_type,
        'session1_start_at',
          ((s.shift_date + s.session1_start)::timestamp AT TIME ZONE 'Asia/Kuwait'),
        'session1_end_at',
          (((s.shift_date + COALESCE(s.session1_end_day_offset, 0)) + s.session1_end)::timestamp
            AT TIME ZONE 'Asia/Kuwait'),
        'session2_start_at',
          CASE WHEN s.session2_start IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_start_day_offset, 0)) + s.session2_start)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'session2_end_at',
          CASE WHEN s.session2_end IS NULL THEN NULL ELSE
            (((s.shift_date + COALESCE(s.session2_end_day_offset, 0)) + s.session2_end)::timestamp
              AT TIME ZONE 'Asia/Kuwait') END,
        'submitted_at', s.submitted_at
      ) AS shift
      FROM public.driver_daily_shifts s
      WHERE s.driver_id = d.id AND s.shift_date = v_day
      LIMIT 1
    ) sh ON true
    WHERE d.archived_at IS NULL
      AND (
        d.is_on_duty
        OR d.is_blocked
        OR public.driver_freeze_is_active(d.frozen_from, d.frozen_until)
        OR dl.last_seen_at >= v_cutoff
        OR open_delivery.id IS NOT NULL
      )
  ) x;

  RETURN jsonb_build_object(
    'generated_at', v_now,
    'kuwait_day', v_day,
    'settings', public._fleet_settings(),
    'drivers', v_drivers
  );
END;
$function$;
