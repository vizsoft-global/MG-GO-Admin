-- P1 (heaviest list/snapshot query in the panel, /payroll): the per-driver day
-- array was a correlated subquery inside `rider_rows`, and Postgres inlined the
-- CTEs it referenced, so the whole month of attendance, reconciliation, cover
-- and adjustment rows was re-derived once per roster driver.
--
-- Measured on production before (admin_payroll_rule_snapshot, 2026-09-01,
-- no slicers): 22,369 ms. Two independent causes, fixed separately so each
-- number is attributable:
--
--   1. Six CTEs were inlined, so `worked`, `recon`, `covers_raw`, `covers`,
--      `adjustments` and `off_structure` were re-executed per driver inside the
--      day subquery. Marking them MATERIALIZED evaluates each once for the call:
--      22,369 ms -> 2,511.7 ms.
--   2. The remaining cost was the per-driver day aggregation itself - a 888-way
--      `CROSS JOIN day_grid` with four LEFT JOINs and a jsonb_agg, i.e. 26,640
--      row-groups each built by an independent nested loop: 2,511.7 ms of which
--      2,455 ms was this node. Hoisting it into one set-based `days_map` CTE lets
--      the planner hash-join the same rows once: 538.5 ms total.
--
-- Net 22,369 ms -> 538.5 ms (41x) for the same 888 riders and the same 91
-- requests.
--
-- Semantics are unchanged and were verified at the array level rather than by
-- eye: both definitions were run in the same transaction with the same
-- arguments and every top-level JSON key compared by md5 - today, month, months,
-- zoneMonth, options, clients, rules, zoneMetrics, canManage, riders, requests,
-- requestKpis. All identical, including `riders` (the only key this touches),
-- which means the day objects, their order and the rider order are identical.
-- The array is built by the same jsonb_build_object over the same four LEFT
-- JOINs with the same `ORDER BY g.d`; only *how many times* it is built changed.
--
-- No filter, slicer, KPI, permission check or return shape is touched, and the
-- REVOKE/GRANT block is re-issued because CREATE OR REPLACE can never be relied
-- on to have set the ACL on a fresh recreate.

CREATE OR REPLACE FUNCTION public.admin_payroll_rule_snapshot(
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
SET search_path = ''
AS $$
DECLARE
  v_today date;
  v_month date;
  v_end date;
  v_days integer;
  v_fixed integer;
  v_cur_month date;
  v_zone_month date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_today := (timezone('Asia/Kuwait', now()))::date;
  v_cur_month := date_trunc('month', v_today)::date;
  v_month := date_trunc('month', p_month)::date;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = 'P0001';
  END IF;
  IF v_month < (v_cur_month - INTERVAL '2 months')::date OR v_month > v_cur_month THEN
    RAISE EXCEPTION 'month_out_of_range' USING ERRCODE = 'P0001';
  END IF;

  v_end := (v_month + INTERVAL '1 month')::date;
  v_days := (v_end - v_month);
  v_fixed := v_days - 2;
  -- SOP section 6: zone efficiency is the previous completed month.
  v_zone_month := (v_month - INTERVAL '1 month')::date;

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
        d.zone_id AS driver_zone_id,
        -- SOP: an Americana rider belongs to their restaurant's zone, falling
        -- back to their own. Every other client uses the driver zone.
        COALESCE(
          CASE WHEN d.project_key = 'americana' THEN rz.zone_id END,
          d.zone_id
        ) AS zone_id,
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
      LEFT JOIN store_map sm ON sm.driver_id = d.id
      LEFT JOIN public.restaurants r ON r.id = sm.restaurant_id
      LEFT JOIN public.restaurants rz ON rz.id = sm.restaurant_id
      LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
      WHERE d.archived_at IS NULL
    ),
    roster_zoned AS (
      SELECT ra.*, z.name AS zone_name
      FROM roster_all ra
      LEFT JOIN public.zones z ON z.id = ra.zone_id
    ),
    roster AS (
      SELECT *
      FROM roster_zoned d
      WHERE (
          p_project_keys IS NULL OR cardinality(p_project_keys) = 0
          OR d.project_key = ANY (p_project_keys)
        )
        -- The slicer accepts either the driver's own zone or the payroll zone,
        -- because for an Americana rider those differ when the restaurant the
        -- rider serves sits in another zone.
        AND (
          p_zone_ids IS NULL OR cardinality(p_zone_ids) = 0
          OR d.zone_id = ANY (p_zone_ids)
          OR d.driver_zone_id = ANY (p_zone_ids)
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
    day_grid AS (
      SELECT (v_month + (g - 1))::date AS d
      FROM generate_series(1, v_days) AS g
    ),
    -- Worked hours: check-in to check-out per Kuwait date. An open log is 0 h,
    -- matching attendanceLogHours() in payroll-formulas.ts.
    worked AS MATERIALIZED (
      SELECT
        l.driver_id,
        (timezone('Asia/Kuwait', l.check_in_at))::date AS d,
        sum(
          COALESCE(EXTRACT(EPOCH FROM (l.check_out_at - l.check_in_at)) / 3600.0, 0)
        )::numeric(8, 2) AS hours
      FROM public.attendance_logs l
      WHERE l.check_in_at >= (v_month::timestamp AT TIME ZONE 'Asia/Kuwait')
        AND l.check_in_at < (v_end::timestamp AT TIME ZONE 'Asia/Kuwait')
      GROUP BY 1, 2
    ),
    -- Daily final adjusted orders: the newest applied Order Reconciliation run
    -- per MG ID and Kuwait day. No second upload.
    am_latest AS (
      SELECT DISTINCT ON (lower(btrim(r.employee_id)), r.work_date)
        lower(btrim(r.employee_id)) AS mg_id,
        r.work_date,
        r.run_id
      FROM public.order_recon_rows r
      JOIN public.order_recon_runs ru ON ru.id = r.run_id
      WHERE ru.status = 'applied'
        AND r.work_date >= v_month
        AND r.work_date < v_end
        AND btrim(COALESCE(r.employee_id, '')) <> ''
      ORDER BY lower(btrim(r.employee_id)), r.work_date, ru.created_at DESC
    ),
    recon AS MATERIALIZED (
      SELECT l.mg_id, l.work_date, COALESCE(SUM(r.excel_orders), 0)::integer AS orders
      FROM am_latest l
      JOIN public.order_recon_rows r
        ON r.run_id = l.run_id
       AND r.work_date = l.work_date
       AND lower(btrim(r.employee_id)) = l.mg_id
      GROUP BY 1, 2
    ),
    req_base AS (
      SELECT
        r.id,
        r.driver_id,
        CASE
          WHEN r.request_type = 'leave'
            AND lower(btrim(COALESCE(r.payload ->> 'leave_type', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'sick_leave'
            AND lower(btrim(COALESCE(r.payload ->> 'leave_subtype', ''))) = 'accident' THEN 'accident'
          WHEN r.request_type = 'leave' THEN 'off'
          WHEN r.request_type = 'sick_leave' THEN 'sick'
          ELSE NULL
        END AS cover,
        (r.status::text IN ('approved', 'awaiting_driver_ack')) AS approved,
        COALESCE(r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) AS start_date,
        COALESCE(r.end_date, r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) AS end_date
      FROM public.requests r
      WHERE COALESCE(r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) <= (v_end - 1)
        AND COALESCE(r.end_date, r.start_date, (timezone('Asia/Kuwait', r.created_at))::date) >= v_month
    ),
    covers_raw AS MATERIALIZED (
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
    covers AS MATERIALIZED (
      SELECT
        c.driver_id,
        c.d,
        CASE WHEN c.accident THEN 'accident' WHEN c.sick THEN 'sick' ELSE 'off' END AS cover,
        CASE
          WHEN c.accident THEN c.approved_accident
          WHEN c.sick THEN c.approved_sick
          ELSE c.approved_off
        END AS approved
      FROM covers_raw c
    ),
    off_structure AS MATERIALIZED (
      SELECT o.driver_id, o.off_days, o.source
      FROM public.driver_off_structure o
      WHERE o.period_month = v_month
    ),
    -- Append-only table: the newest row for a day is the one that counts, and
    -- an 'auto' row is a revert rather than a delete.
    adjustments AS MATERIALIZED (
      SELECT DISTINCT ON (a.driver_id, a.work_date)
        a.driver_id,
        a.work_date,
        a.original_status,
        a.adjusted_status,
        a.adjusted_hours,
        a.reason,
        a.adjusted_by_name,
        a.adjusted_at
      FROM public.payroll_manual_adjustments a
      WHERE a.work_date >= v_month
        AND a.work_date < v_end
      ORDER BY a.driver_id, a.work_date, a.adjusted_at DESC, a.id DESC
    ),
    clients AS (
      SELECT c.* FROM public.payroll_clients c WHERE c.is_active
    ),
    -- One pass for the whole roster instead of one nested loop per driver. The
    -- body is the subquery that used to sit inside rider_rows, character for
    -- character: same day grid, same four LEFT JOINs, same jsonb_build_object
    -- and the same `ORDER BY g.d`, so the array is identical.
    days_map(driver_id, days) AS MATERIALIZED (
      SELECT r.id, jsonb_agg(
        jsonb_build_object(
          'd', to_char(g.d, 'YYYY-MM-DD'),
          'h', COALESCE(w.hours, 0),
          'o', COALESCE(rc.orders, 0),
          -- Whether an attendance log exists at all. A check-in with no
          -- check-out is 0 h, and the legacy branch must still read it as
          -- a worked day rather than an absent one.
          'k', w.driver_id IS NOT NULL,
          'c', cv.cover,
          'ca', COALESCE(cv.approved, false),
          'x', aj.adjusted_status,
          'xh', aj.adjusted_hours
        )
        ORDER BY g.d
      )
      FROM roster r
      CROSS JOIN day_grid g
      LEFT JOIN worked w ON w.driver_id = r.id AND w.d = g.d
      LEFT JOIN recon rc ON rc.mg_id = lower(btrim(r.employee_id)) AND rc.work_date = g.d
      LEFT JOIN covers cv ON cv.driver_id = r.id AND cv.d = g.d
      LEFT JOIN adjustments aj ON aj.driver_id = r.id AND aj.work_date = g.d
      GROUP BY r.id
    ),
    rider_rows AS (
      SELECT
        r.id,
        jsonb_build_object(
          'driverId', r.id,
          'amId', COALESCE(r.employee_id, '—'),
          'mgId', COALESCE(r.driver_code, '—'),
          'name', r.name,
          'employeeId', r.employee_id,
          'restaurant', CASE
            WHEN r.project_key = 'keeta' THEN '(Pool)'
            WHEN NULLIF(btrim(r.restaurant_name), '') IS NULL THEN '(Pool)'
            ELSE r.restaurant_name
          END,
          'restaurantId', r.restaurant_id,
          'zone', COALESCE(r.zone_name, '—'),
          'zoneId', r.zone_id,
          'zoneName', r.zone_name,
          'partner', CASE r.project_key
            WHEN 'americana' THEN 'Americana'
            WHEN 'keeta' THEN 'Keeta'
            ELSE '—'
          END,
          'projectKey', r.project_key,
          'nationality', COALESCE(r.nationality, '—'),
          'nationalityCode', r.nationality,
          'status', CASE WHEN r.status = 'active' THEN 'Active' ELSE 'Inactive' END,
          'vehicleKey', r.vehicle_key,
          'sourceType', r.rider_category,
          'sourceCompany', r.source_company,
          'offStructureDays', COALESCE(os.off_days, c.default_off_days, 2),
          'offStructureSource', CASE
            WHEN os.driver_id IS NULL THEN 'default'
            WHEN os.source = 'bulk_upload' THEN 'bulk_upload'
            ELSE 'manual'
          END,
          'days', COALESCE(dm.days, '[]'::jsonb)
        ) AS row_json
      FROM roster r
      LEFT JOIN days_map dm ON dm.driver_id = r.id
      LEFT JOIN off_structure os ON os.driver_id = r.id
      LEFT JOIN public.payroll_clients c ON c.key = r.project_key
    ),
    request_ids AS (
      SELECT q.id FROM req_base q JOIN roster d ON d.id = q.driver_id
    ),
    current_step AS (
      SELECT DISTINCT ON (s.request_id)
        s.request_id,
        s.step_name,
        s.role_key
      FROM public.request_approval_steps s
      JOIN request_ids ri ON ri.id = s.request_id
      ORDER BY s.request_id,
        CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END,
        s.step_order
    ),
    request_base AS (
      SELECT
        rq.id,
        rq.request_code,
        rq.driver_id,
        rq.request_type,
        rq.status::text AS status,
        rq.payload,
        rq.current_step_label,
        COALESCE(rq.start_date, (timezone('Asia/Kuwait', rq.created_at))::date) AS start_date,
        (timezone('Asia/Kuwait', rq.created_at))::date AS created_date,
        CASE
          WHEN rq.request_type = 'leave'
            AND lower(btrim(COALESCE(rq.payload ->> 'leave_type', ''))) = 'accident' THEN 'accident'
          WHEN rq.request_type = 'sick_leave'
            AND lower(btrim(COALESCE(rq.payload ->> 'leave_subtype', ''))) = 'accident' THEN 'accident'
          WHEN rq.request_type = 'leave' THEN 'leave'
          WHEN rq.request_type = 'sick_leave' THEN 'sick'
          WHEN rq.request_type IN ('fuel', 'fuel_refund') THEN 'fuel'
          WHEN rq.request_type IN ('asset', 'loan', 'document', 'salary_justification')
            THEN rq.request_type
          ELSE NULL
        END AS tile
      FROM public.requests rq
      WHERE COALESCE(rq.start_date, (timezone('Asia/Kuwait', rq.created_at))::date) <= (v_end - 1)
        AND COALESCE(rq.end_date, rq.start_date, (timezone('Asia/Kuwait', rq.created_at))::date) >= v_month
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
      FROM request_base q
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
          'days', ((m + INTERVAL '1 month')::date - m::date),
          'label', to_char(m, 'Mon YYYY'),
          'fixedDays', ((m + INTERVAL '1 month')::date - m::date) - 2
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
      'zoneMonth', to_char(v_zone_month, 'YYYY-MM'),
      'options', jsonb_build_object(
        'zones', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) ORDER BY z.name)
          FROM (
            SELECT DISTINCT zone_id AS id, zone_name AS name
            FROM roster_zoned
            WHERE zone_id IS NOT NULL AND zone_name IS NOT NULL
          ) z
        ), '[]'::jsonb),
        'restaurants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
          FROM (
            SELECT DISTINCT restaurant_id AS id, restaurant_name AS name
            FROM roster_zoned
            WHERE restaurant_id IS NOT NULL
              AND restaurant_name IS NOT NULL
              AND project_key IS DISTINCT FROM 'keeta'
          ) s
        ), '[]'::jsonb),
        'nationalities', COALESCE((
          SELECT jsonb_agg(n ORDER BY n)
          FROM (SELECT DISTINCT nationality AS n FROM roster_zoned WHERE nationality IS NOT NULL) x
        ), '[]'::jsonb),
        'sourceCompanies', COALESCE((
          SELECT jsonb_agg(n ORDER BY n)
          FROM (SELECT DISTINCT source_company AS n FROM roster_zoned WHERE source_company IS NOT NULL) x
        ), '[]'::jsonb)
      ),
      'clients', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', c.key,
            'name', c.name,
            'usesZone', c.uses_zone,
            'usesOrders', c.uses_orders,
            'usesHours', c.uses_hours,
            'fullDayHours', c.full_day_hours,
            'halfDayHours', c.half_day_hours,
            'reducedHours', c.reduced_hours,
            'requiredHoursPerDay', c.required_hours_per_day,
            'defaultOffDays', c.default_off_days,
            'defaultResult', c.default_result,
            'goodThreshold', c.good_threshold,
            'averageThreshold', c.average_threshold,
            'isSystem', c.is_system,
            'sortOrder', c.sort_order
          )
          ORDER BY c.sort_order, c.key
        )
        FROM clients c
      ), '[]'::jsonb),
      'rules', COALESCE((
        SELECT jsonb_agg(
          elem
          ORDER BY elem ->> 'clientKey', (elem ->> 'sortOrder')::int
        )
        FROM clients c
        CROSS JOIN LATERAL jsonb_array_elements(
          public.payroll_effective_rules(c.key, v_month)
        ) AS elem
      ), '[]'::jsonb),
      'zoneMetrics', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'zoneId', z.id,
            'zoneName', z.name,
            'orders', COALESCE(m.orders, 0),
            'riderDays', COALESCE(m.rider_days, 0),
            'dpd', m.dpd,
            'targetDpd', m.target_dpd,
            'dpdUsed', m.dpd_used,
            'targetDpdUsed', m.target_dpd_used,
            'efficiency', m.efficiency,
            'categoryAuto', m.category_auto,
            'categoryOverride', m.category_override,
            'goodThreshold', COALESCE(m.good_threshold, 110),
            'averageThreshold', COALESCE(m.average_threshold, 70),
            'computedAt', to_char(m.computed_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI')
          )
          ORDER BY z.name
        )
        FROM public.zones z
        LEFT JOIN public.payroll_zone_metrics m
          ON m.zone_id = z.id AND m.period_month = v_zone_month
      ), '[]'::jsonb),
      'canManage', public.payroll_can_manage(),
      'riders', COALESCE((
        SELECT jsonb_agg(rr.row_json ORDER BY rr.row_json ->> 'name')
        FROM rider_rows rr
      ), '[]'::jsonb),
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
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_payroll_rule_snapshot(
  date, uuid[], text[], text[], text[], text[], text[], uuid[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_payroll_rule_snapshot(
  date, uuid[], text[], text[], text[], text[], text[], uuid[]
) TO authenticated, service_role;
