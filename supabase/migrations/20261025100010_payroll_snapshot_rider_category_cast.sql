-- 20261025100000 compared rider_category (enum driver_rider_category) to
-- p_source_types text[] at plan time, so even an unfiltered call raised 42883.

CREATE OR REPLACE FUNCTION public.admin_payroll_month_snapshot(
  p_month date,
  p_zone_ids uuid[] DEFAULT NULL,
  p_project_keys text[] DEFAULT NULL,
  p_vehicle_keys text[] DEFAULT NULL,
  p_nationalities text[] DEFAULT NULL,
  p_source_types text[] DEFAULT NULL,
  p_source_companies text[] DEFAULT NULL,
  p_restaurant_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date;
  v_month date;
  v_end date;
  v_days integer;
  v_fixed integer;
  v_cur_month date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_today := (timezone('Asia/Kuwait', now()))::date;
  v_cur_month := date_trunc('month', v_today)::date;
  v_month := date_trunc('month', p_month)::date;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month';
  END IF;
  IF v_month < (v_cur_month - INTERVAL '2 months')::date OR v_month > v_cur_month THEN
    RAISE EXCEPTION 'month_out_of_range';
  END IF;

  v_end := (v_month + INTERVAL '1 month')::date;
  v_days := (v_end - v_month);
  v_fixed := v_days - 2;

  RETURN (
    WITH store_map AS (
      SELECT DISTINCT ON (dr.driver_id)
        dr.driver_id,
        dr.restaurant_id
      FROM public.driver_restaurants dr
      ORDER BY dr.driver_id, dr.restaurant_id ASC
    ),
    roster_all AS (
      SELECT
        d.id,
        COALESCE(NULLIF(btrim(p.full_name), ''), '—') AS name,
        NULLIF(btrim(d.employee_id), '') AS employee_id,
        NULLIF(btrim(d.driver_code), '') AS driver_code,
        d.zone_id,
        z.name AS zone_name,
        d.project_key,
        d.nationality,
        d.rider_category,
        d.source_company,
        d.status,
        CASE WHEN d.vehicle_id IS NULL THEN NULL ELSE v.vehicle_type_key END AS vehicle_key,
        sm.restaurant_id,
        CASE WHEN d.project_key = 'keeta' THEN NULL ELSE r.name END AS restaurant_name
      FROM public.drivers d
      LEFT JOIN public.profiles p ON p.id = d.id
      LEFT JOIN public.zones z ON z.id = d.zone_id
      LEFT JOIN store_map sm ON sm.driver_id = d.id
      LEFT JOIN public.restaurants r ON r.id = sm.restaurant_id
      LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
      WHERE d.archived_at IS NULL
    ),
    roster AS (
      SELECT *
      FROM roster_all d
      WHERE (
          p_project_keys IS NULL OR cardinality(p_project_keys) = 0
          OR d.project_key = ANY (p_project_keys)
        )
        AND (
          p_zone_ids IS NULL OR cardinality(p_zone_ids) = 0
          OR d.zone_id = ANY (p_zone_ids)
        )
        AND (
          p_vehicle_keys IS NULL OR cardinality(p_vehicle_keys) = 0
          OR (d.vehicle_key IS NOT NULL AND d.vehicle_key = ANY (p_vehicle_keys))
        )
        AND (
          p_nationalities IS NULL OR cardinality(p_nationalities) = 0
          OR d.nationality = ANY (p_nationalities)
        )
        AND (
          p_source_types IS NULL OR cardinality(p_source_types) = 0
          OR d.rider_category::text = ANY (p_source_types)
        )
        AND (
          p_source_companies IS NULL OR cardinality(p_source_companies) = 0
          OR d.source_company = ANY (p_source_companies)
        )
        AND (
          p_restaurant_ids IS NULL OR cardinality(p_restaurant_ids) = 0
          OR d.restaurant_id = ANY (p_restaurant_ids)
        )
    ),
    checkins AS (
      SELECT DISTINCT
        l.driver_id,
        (timezone('Asia/Kuwait', l.check_in_at))::date AS d
      FROM public.attendance_logs l
      WHERE l.check_in_at >= (v_month::timestamp AT TIME ZONE 'Asia/Kuwait')
        AND l.check_in_at < (v_end::timestamp AT TIME ZONE 'Asia/Kuwait')
    ),
    req_base AS (
      SELECT
        r.id,
        r.request_code,
        r.driver_id,
        r.request_type,
        r.status::text AS status,
        r.payload,
        r.current_step_label,
        COALESCE(r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) AS start_date,
        COALESCE(r.end_date, r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) AS end_date,
        (timezone('Asia/Kuwait', r.created_at))::date AS created_date,
        CASE
          WHEN r.request_type = 'leave'
            AND lower(btrim(COALESCE(r.payload->>'leave_type', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'sick_leave'
            AND lower(btrim(COALESCE(r.payload->>'leave_subtype', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'leave' THEN 'leave'
          WHEN r.request_type = 'sick_leave' THEN 'sick'
          WHEN r.request_type IN ('fuel', 'fuel_refund') THEN 'fuel'
          WHEN r.request_type IN ('asset', 'loan', 'document', 'salary_justification')
            THEN r.request_type
          ELSE NULL
        END AS tile,
        CASE
          WHEN r.request_type = 'leave'
            AND lower(btrim(COALESCE(r.payload->>'leave_type', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'sick_leave'
            AND lower(btrim(COALESCE(r.payload->>'leave_subtype', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'leave' THEN 'off'
          WHEN r.request_type = 'sick_leave' THEN 'sick'
          ELSE NULL
        END AS cover,
        (r.status::text IN ('approved', 'awaiting_driver_ack')) AS approved
      FROM public.requests r
      WHERE COALESCE(r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) <= (v_end - 1)
        AND COALESCE(r.end_date, r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) >= v_month
    ),
    day_grid AS (
      SELECT (v_month + (g - 1))::date AS d
      FROM generate_series(1, v_days) AS g
    ),
    covers AS (
      SELECT
        q.driver_id,
        g.d,
        bool_or(q.cover = 'accident') AS accident,
        bool_or(q.cover = 'sick') AS sick,
        bool_or(q.cover = 'off') AS off,
        bool_or(q.cover = 'accident' AND q.approved) AS approved_accident,
        bool_or(q.cover = 'sick' AND q.approved) AS approved_sick,
        bool_or(q.cover = 'off' AND q.approved) AS approved_off
      FROM req_base q
      JOIN day_grid g ON g.d BETWEEN q.start_date AND q.end_date
      WHERE q.cover IS NOT NULL
      GROUP BY q.driver_id, g.d
    ),
    classified AS (
      SELECT
        d.id AS driver_id,
        g.d,
        CASE
          WHEN g.d > v_today THEN 'blank'
          WHEN c.driver_id IS NOT NULL THEN 'work'
          WHEN COALESCE(cv.accident, false) THEN 'accident'
          WHEN COALESCE(cv.sick, false) THEN 'sick'
          WHEN COALESCE(cv.off, false) THEN 'off'
          ELSE 'absent'
        END AS status,
        CASE
          WHEN g.d > v_today THEN false
          WHEN c.driver_id IS NOT NULL THEN false
          WHEN COALESCE(cv.accident, false) THEN NOT COALESCE(cv.approved_accident, false)
          WHEN COALESCE(cv.sick, false) THEN NOT COALESCE(cv.approved_sick, false)
          WHEN COALESCE(cv.off, false) THEN NOT COALESCE(cv.approved_off, false)
          ELSE false
        END AS unjustified
      FROM roster d
      CROSS JOIN day_grid g
      LEFT JOIN checkins c ON c.driver_id = d.id AND c.d = g.d
      LEFT JOIN covers cv ON cv.driver_id = d.id AND cv.d = g.d
    ),
    rider_rows AS (
      SELECT
        d.id AS "driverId",
        COALESCE(d.employee_id, '—') AS "amId",
        COALESCE(d.driver_code, '—') AS "mgId",
        d.name,
        CASE
          WHEN d.project_key = 'keeta' THEN '(Pool)'
          WHEN NULLIF(btrim(d.restaurant_name), '') IS NULL THEN '(Pool)'
          ELSE d.restaurant_name
        END AS restaurant,
        d.restaurant_id AS "restaurantId",
        COALESCE(d.zone_name, '—') AS zone,
        d.zone_id AS "zoneId",
        CASE d.project_key
          WHEN 'americana' THEN 'Americana'
          WHEN 'keeta' THEN 'Keeta'
          ELSE '—'
        END AS partner,
        d.project_key AS "projectKey",
        COALESCE(d.nationality, '—') AS nationality,
        d.nationality AS "nationalityCode",
        CASE WHEN d.status = 'active' THEN 'Active' ELSE 'Inactive' END AS status,
        d.vehicle_key AS "vehicleKey",
        d.rider_category AS "sourceType",
        d.source_company AS "sourceCompany",
        (
          SELECT coalesce(jsonb_agg(cl.status ORDER BY cl.d), '[]'::jsonb)
          FROM classified cl
          WHERE cl.driver_id = d.id
        ) AS days,
        COUNT(*) FILTER (WHERE cl.status = 'work')::int AS "workDays",
        (COUNT(*) FILTER (WHERE cl.status = 'work') * 12)::int AS "totalHours",
        COUNT(*) FILTER (WHERE cl.status = 'off')::int AS "offDays",
        COUNT(*) FILTER (WHERE cl.status = 'sick')::int AS "sickDays",
        COUNT(*) FILTER (WHERE cl.status = 'accident')::int AS "accidentDays",
        COUNT(*) FILTER (WHERE cl.status = 'absent')::int AS "absentDays",
        v_fixed AS "fixedDays",
        CASE
          WHEN v_fixed <= 0 THEN 0
          ELSE (COUNT(*) FILTER (WHERE cl.status = 'work')::numeric / v_fixed) * 100
        END AS efficiency,
        COUNT(*) FILTER (WHERE cl.unjustified)::int AS unjustified
      FROM roster d
      JOIN classified cl ON cl.driver_id = d.id
      GROUP BY
        d.id, d.employee_id, d.driver_code, d.name, d.project_key, d.restaurant_name,
        d.restaurant_id, d.zone_name, d.zone_id, d.nationality, d.status, d.vehicle_key,
        d.rider_category, d.source_company
    ),
    current_step AS (
      SELECT DISTINCT ON (s.request_id)
        s.request_id,
        s.step_name,
        s.role_key
      FROM public.request_approval_steps s
      JOIN req_base q ON q.id = s.request_id
      ORDER BY s.request_id,
        CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END,
        s.step_order
    ),
    request_rows AS (
      SELECT
        q.id,
        q.request_code AS code,
        q.driver_id AS "driverId",
        d.name AS "riderName",
        COALESCE(d.driver_code, d.employee_id, '—') AS "riderCode",
        q.tile,
        to_char(q.start_date, 'YYYY-MM-DD') AS day,
        COALESCE(d.zone_name, '—') AS zone,
        CASE d.project_key
          WHEN 'americana' THEN 'Americana'
          WHEN 'keeta' THEN 'Keeta'
          ELSE '—'
        END AS partner,
        COALESCE(
          NULLIF(btrim(q.current_step_label), ''),
          NULLIF(btrim(cs.step_name), ''),
          CASE cs.role_key
            WHEN 'reporting_manager' THEN 'Reporting Manager'
            WHEN 'manager' THEN 'Reporting Manager'
            WHEN 'hr' THEN 'HR'
            WHEN 'payroll' THEN 'Payroll'
            WHEN 'fleet' THEN 'Fleet'
            WHEN 'operations' THEN 'Operations'
            WHEN 'finance' THEN 'Finance'
            ELSE COALESCE(cs.role_key, '—')
          END
        ) AS "reviewingDept",
        q.status AS "liveStatus",
        CASE q.status
          WHEN 'submitted' THEN 'pending'
          WHEN 'rejected' THEN 'rejected'
          WHEN 'approved' THEN 'approved'
          WHEN 'awaiting_driver_ack' THEN 'approved'
          WHEN 'solved' THEN 'approved'
          WHEN 'responded' THEN 'approved'
          WHEN 'closed' THEN 'approved'
          ELSE 'under_review'
        END AS "uiStatus"
      FROM req_base q
      JOIN roster d ON d.id = q.driver_id
      LEFT JOIN current_step cs ON cs.request_id = q.id
      WHERE q.tile IS NOT NULL
    ),
    months AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', to_char(m, 'YYYY-MM'),
          'year', extract(year FROM m)::int,
          'month', extract(month FROM m)::int,
          'days', ((m + INTERVAL '1 month')::date - m),
          'label', to_char(m, 'Mon YYYY'),
          'fixedDays', ((m + INTERVAL '1 month')::date - m) - 2
        )
        ORDER BY m DESC
      ) AS arr
      FROM generate_series(v_cur_month - INTERVAL '2 months', v_cur_month, INTERVAL '1 month') AS m
    )
    SELECT jsonb_build_object(
      'today', to_char(v_today, 'YYYY-MM-DD'),
      'month', jsonb_build_object(
        'key', to_char(v_month, 'YYYY-MM'),
        'year', extract(year FROM v_month)::int,
        'month', extract(month FROM v_month)::int,
        'days', v_days,
        'label', to_char(v_month, 'Mon YYYY'),
        'fixedDays', v_fixed
      ),
      'months', (SELECT arr FROM months),
      'options', jsonb_build_object(
        'zones', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) ORDER BY z.name)
          FROM (
            SELECT DISTINCT zone_id AS id, zone_name AS name
            FROM roster_all
            WHERE zone_id IS NOT NULL AND zone_name IS NOT NULL
          ) z
        ), '[]'::jsonb),
        'restaurants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
          FROM (
            SELECT DISTINCT restaurant_id AS id, restaurant_name AS name
            FROM roster_all
            WHERE restaurant_id IS NOT NULL
              AND restaurant_name IS NOT NULL
              AND project_key IS DISTINCT FROM 'keeta'
          ) s
        ), '[]'::jsonb),
        'nationalities', COALESCE((
          SELECT jsonb_agg(n ORDER BY n)
          FROM (SELECT DISTINCT nationality AS n FROM roster_all WHERE nationality IS NOT NULL) x
        ), '[]'::jsonb),
        'sourceCompanies', COALESCE((
          SELECT jsonb_agg(n ORDER BY n)
          FROM (SELECT DISTINCT source_company AS n FROM roster_all WHERE source_company IS NOT NULL) x
        ), '[]'::jsonb)
      ),
      'riders', COALESCE((SELECT jsonb_agg(to_jsonb(rr) ORDER BY rr.name) FROM rider_rows rr), '[]'::jsonb),
      'requests', COALESCE((
        SELECT jsonb_agg(to_jsonb(rq) ORDER BY
          CASE rq."uiStatus"
            WHEN 'pending' THEN 0
            WHEN 'under_review' THEN 1
            WHEN 'approved' THEN 2
            ELSE 3
          END,
          rq.day
        )
        FROM request_rows rq
      ), '[]'::jsonb),
      'payrollKpis', jsonb_build_object(
        'riders', (SELECT COUNT(*) FROM rider_rows),
        'active', (SELECT COUNT(*) FROM rider_rows WHERE status = 'Active'),
        'avgEfficiency', COALESCE((SELECT AVG(efficiency) FROM rider_rows), 0),
        'atOrAbove100', (SELECT COUNT(*) FROM rider_rows WHERE efficiency >= 100),
        'unjustifiedRiders', (SELECT COUNT(*) FROM rider_rows WHERE unjustified > 0)
      ),
      'requestKpis', jsonb_build_object(
        'total', (SELECT COUNT(*) FROM request_rows),
        'pending', (SELECT COUNT(*) FROM request_rows WHERE "uiStatus" = 'pending'),
        'underReview', (SELECT COUNT(*) FROM request_rows WHERE "uiStatus" = 'under_review'),
        'approved', (SELECT COUNT(*) FROM request_rows WHERE "uiStatus" = 'approved'),
        'rejected', (SELECT COUNT(*) FROM request_rows WHERE "uiStatus" = 'rejected'),
        'approvalRate', CASE
          WHEN (SELECT COUNT(*) FROM request_rows) = 0 THEN 0
          ELSE (
            (SELECT COUNT(*) FROM request_rows WHERE "uiStatus" = 'approved')::numeric
            / (SELECT COUNT(*) FROM request_rows)
          ) * 100
        END
      ),
      'workflow', jsonb_build_object(
        'awaitingAction', (
          SELECT COUNT(*) FROM request_rows
          WHERE "uiStatus" IN ('pending', 'under_review')
        ),
        'requestsPerRider', CASE
          WHEN (SELECT COUNT(*) FROM rider_rows) = 0 THEN 0
          ELSE round((
            (SELECT COUNT(*) FROM request_rows)::numeric
            / (SELECT COUNT(*) FROM rider_rows)
          ), 1)
        END
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_month_snapshot(
  date, uuid[], text[], text[], text[], text[], text[], uuid[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_payroll_month_snapshot(
  date, uuid[], text[], text[], text[], text[], text[], uuid[]
) TO authenticated;
