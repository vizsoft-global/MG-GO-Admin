-- Live DPD dashboard, in one round trip.
--
-- The live tab polls, so every number it shows has to arrive together: five
-- client queries would each carry their own latency and could disagree with
-- each other mid-refresh (deliveries counted after a rider clocked out).
--
-- Today's average score reuses admin_list_driver_performance rather than
-- re-deriving the composite here. Measured at ~148ms for the whole fleet over
-- a single day on production, which a 30s poll can afford, and duplicating the
-- weighting would let the live tab and the period tab drift apart.

CREATE OR REPLACE FUNCTION public.admin_dpd_live_snapshot(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  -- Matches gpsOfflineIdleSeconds in the shared tracking thresholds: an idle
  -- rider heartbeats every 150s, so anything shorter flags a parked bike.
  v_gps_offline_seconds constant integer := 150;
  v_deliveries jsonb;
  v_roster jsonb;
  v_alerts jsonb;
  v_leaderboard jsonb;
  v_zones jsonb;
  v_partners jsonb;
  v_score jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kuwait')::date);
  v_start := (v_date::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_end := ((v_date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');

  SELECT jsonb_build_object(
    'created', COUNT(*),
    'in_transit', COUNT(*) FILTER (WHERE d.status = 'in_transit'),
    'pending', COUNT(*) FILTER (WHERE d.status = 'pending'),
    'under_review', COUNT(*) FILTER (WHERE d.status = 'under_review'),
    'verified', COUNT(*) FILTER (WHERE d.status = 'verified'),
    'rejected', COUNT(*) FILTER (WHERE d.status = 'rejected'),
    'cancelled', COUNT(*) FILTER (WHERE d.status = 'cancelled')
  )
  INTO v_deliveries
  FROM public.deliveries d
  WHERE d.created_at >= v_start AND d.created_at < v_end;

  SELECT jsonb_build_object(
    'active_drivers', COUNT(*) FILTER (WHERE dr.status = 'active'),
    'total_drivers', COUNT(*),
    'on_duty', COUNT(*) FILTER (WHERE dr.is_on_duty),
    'tracking_live', COUNT(*) FILTER (
      WHERE dr.is_on_duty
        AND dl.last_report_at IS NOT NULL
        AND dl.last_report_at > now() - make_interval(secs => v_gps_offline_seconds)
    ),
    'checked_in', (
      SELECT COUNT(DISTINCT al.driver_id)
      FROM public.attendance_logs al
      WHERE al.log_date = v_date AND al.check_in_at IS NOT NULL
    )
  )
  INTO v_roster
  FROM public.drivers dr
  LEFT JOIN public.driver_locations dl ON dl.driver_id = dr.id
  WHERE dr.archived_at IS NULL;

  SELECT jsonb_build_object(
    'out_of_zone', COUNT(*) FILTER (WHERE dl.out_of_zone_since IS NOT NULL),
    'gps_offline', COUNT(*) FILTER (
      WHERE dl.last_report_at IS NULL
        OR dl.last_report_at <= now() - make_interval(secs => v_gps_offline_seconds)
    ),
    'low_battery', COUNT(*) FILTER (WHERE dl.battery_pct IS NOT NULL AND dl.battery_pct <= 15)
  )
  INTO v_alerts
  FROM public.drivers dr
  LEFT JOIN public.driver_locations dl ON dl.driver_id = dr.id
  WHERE dr.archived_at IS NULL AND dr.is_on_duty;

  WITH day_rows AS (
    SELECT d.driver_id, d.status
    FROM public.deliveries d
    WHERE d.created_at >= v_start AND d.created_at < v_end
      AND d.driver_id IS NOT NULL
  ),
  per_driver AS (
    SELECT
      r.driver_id,
      COUNT(*)::integer AS submitted,
      COUNT(*) FILTER (WHERE r.status = 'verified')::integer AS verified,
      COUNT(*) FILTER (WHERE r.status = 'in_transit')::integer AS in_transit
    FROM day_rows r
    GROUP BY r.driver_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'driver_id', x.driver_id,
        'driver_name', x.driver_name,
        'driver_code', x.driver_code,
        'zone_name', x.zone_name,
        'partner_name', x.partner_name,
        'is_on_duty', x.is_on_duty,
        'submitted', x.submitted,
        'verified', x.verified,
        'in_transit', x.in_transit
      )
      ORDER BY x.rn
    ),
    '[]'::jsonb
  )
  INTO v_leaderboard
  FROM (
    SELECT
      pd.driver_id,
      COALESCE(pr.full_name, '—') AS driver_name,
      dr.driver_code,
      z.name AS zone_name,
      pt.name AS partner_name,
      dr.is_on_duty,
      pd.submitted,
      pd.verified,
      pd.in_transit,
      ROW_NUMBER() OVER (
        ORDER BY pd.verified DESC, pd.submitted DESC, pr.full_name ASC
      ) AS rn
    FROM per_driver pd
    JOIN public.drivers dr ON dr.id = pd.driver_id
    LEFT JOIN public.profiles pr ON pr.id = dr.id
    LEFT JOIN public.zones z ON z.id = dr.zone_id
    LEFT JOIN public.partners pt ON pt.id = dr.partner_id
    WHERE dr.archived_at IS NULL
    ORDER BY pd.verified DESC, pd.submitted DESC
    LIMIT 10
  ) x;

  -- Unassigned is its own bucket, not a dropped row. Most production riders and
  -- deliveries carry no zone or partner, so keying off the zones table alone
  -- returned an empty breakdown under a KPI reading 420 deliveries — bars that
  -- silently disagree with the number above them. A null id means unassigned
  -- and the UI names it; UNION folds the null keys into one.
  WITH zone_deliveries AS (
    SELECT d.zone_id, COUNT(*)::integer AS deliveries
    FROM public.deliveries d
    WHERE d.created_at >= v_start AND d.created_at < v_end
    GROUP BY d.zone_id
  ),
  zone_riders AS (
    SELECT dr.zone_id, COUNT(*) FILTER (WHERE dr.is_on_duty)::integer AS on_duty
    FROM public.drivers dr
    WHERE dr.archived_at IS NULL
    GROUP BY dr.zone_id
  ),
  zone_keys AS (
    SELECT zone_id FROM zone_deliveries
    UNION
    SELECT zone_id FROM zone_riders
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', y.id,
        'label', y.label,
        'deliveries', y.deliveries,
        'on_duty', y.on_duty
      )
      ORDER BY y.rn
    ),
    '[]'::jsonb
  )
  INTO v_zones
  FROM (
    SELECT
      k.zone_id::text AS id,
      z.name AS label,
      COALESCE(zd.deliveries, 0) AS deliveries,
      COALESCE(zr.on_duty, 0) AS on_duty,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(zd.deliveries, 0) DESC, COALESCE(zr.on_duty, 0) DESC, z.name ASC NULLS LAST
      ) AS rn
    FROM zone_keys k
    LEFT JOIN public.zones z ON z.id = k.zone_id
    LEFT JOIN zone_deliveries zd ON zd.zone_id IS NOT DISTINCT FROM k.zone_id
    LEFT JOIN zone_riders zr ON zr.zone_id IS NOT DISTINCT FROM k.zone_id
    WHERE COALESCE(zd.deliveries, 0) > 0 OR COALESCE(zr.on_duty, 0) > 0
    ORDER BY rn
    LIMIT 12
  ) y;

  WITH partner_deliveries AS (
    SELECT d.partner_id, COUNT(*)::integer AS deliveries
    FROM public.deliveries d
    WHERE d.created_at >= v_start AND d.created_at < v_end
    GROUP BY d.partner_id
  ),
  partner_riders AS (
    SELECT dr.partner_id, COUNT(*) FILTER (WHERE dr.is_on_duty)::integer AS on_duty
    FROM public.drivers dr
    WHERE dr.archived_at IS NULL
    GROUP BY dr.partner_id
  ),
  partner_keys AS (
    SELECT partner_id FROM partner_deliveries
    UNION
    SELECT partner_id FROM partner_riders
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', y.id,
        'label', y.label,
        'deliveries', y.deliveries,
        'on_duty', y.on_duty
      )
      ORDER BY y.rn
    ),
    '[]'::jsonb
  )
  INTO v_partners
  FROM (
    SELECT
      k.partner_id::text AS id,
      pt.name AS label,
      COALESCE(pd.deliveries, 0) AS deliveries,
      COALESCE(prd.on_duty, 0) AS on_duty,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(pd.deliveries, 0) DESC, COALESCE(prd.on_duty, 0) DESC, pt.name ASC NULLS LAST
      ) AS rn
    FROM partner_keys k
    LEFT JOIN public.partners pt ON pt.id = k.partner_id
    LEFT JOIN partner_deliveries pd ON pd.partner_id IS NOT DISTINCT FROM k.partner_id
    LEFT JOIN partner_riders prd ON prd.partner_id IS NOT DISTINCT FROM k.partner_id
    WHERE COALESCE(pd.deliveries, 0) > 0 OR COALESCE(prd.on_duty, 0) > 0
    ORDER BY rn
    LIMIT 12
  ) y;

  SELECT public.admin_list_driver_performance(
    v_date, v_date, NULL, NULL, NULL, NULL, NULL, NULL, 'overall_desc', 1, 0
  ) -> 'kpis'
  INTO v_score;

  RETURN jsonb_build_object(
    'date', v_date,
    'generated_at', now(),
    'deliveries', COALESCE(v_deliveries, '{}'::jsonb),
    'roster', COALESCE(v_roster, '{}'::jsonb),
    'alerts', COALESCE(v_alerts, '{}'::jsonb),
    'leaderboard', COALESCE(v_leaderboard, '[]'::jsonb),
    'zones', COALESCE(v_zones, '[]'::jsonb),
    'partners', COALESCE(v_partners, '[]'::jsonb),
    'score', COALESCE(v_score, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dpd_live_snapshot(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_dpd_live_snapshot(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_dpd_live_snapshot(date) TO authenticated;
