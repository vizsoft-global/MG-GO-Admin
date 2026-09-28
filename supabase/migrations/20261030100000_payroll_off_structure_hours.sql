-- Payroll SOP update: driver-specific monthly Off Structure + hours-based
-- Attendance Efficiency.
--
-- Attendance Efficiency was a day count: work days / (days in month - 2), with
-- Total Hours painted as work days * 12. The SOP asks for
--   Actual Worked Hours / Required Hours
-- where Actual Worked Hours comes from attendance_logs check-in -> check-out
-- (no cap) and Required Hours comes from a per-driver, per-month Off Structure.
--
-- A driver with no Off Structure row falls back to 2 off days, which is exactly
-- the fixedDays = days - 2 rule the page used before, so a month nobody has
-- uploaded yet keeps its Required Hours.

-- 1. payroll.manage -------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('payroll.manage', 'Manage payroll off structure', 'payroll')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- Roles that can already both see payroll and correct attendance.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT a.role_id, 'payroll.manage'
FROM public.admin_role_permissions a
WHERE a.permission_slug = 'payroll.view'
  AND EXISTS (
    SELECT 1
    FROM public.admin_role_permissions r
    WHERE r.role_id = a.role_id
      AND r.permission_slug = 'attendance.manage'
  )
ON CONFLICT DO NOTHING;

-- Per-user ticks (access_kind = 'user') follow the same rule, otherwise every
-- existing payroll user would lose the page's write path on deploy.
INSERT INTO public.admin_user_permissions (user_id, permission_slug)
SELECT u.user_id, 'payroll.manage'
FROM public.admin_user_permissions u
WHERE u.permission_slug = 'payroll.view'
  AND EXISTS (
    SELECT 1
    FROM public.admin_user_permissions x
    WHERE x.user_id = u.user_id
      AND x.permission_slug = 'attendance.manage'
  )
ON CONFLICT DO NOTHING;

-- 2. driver_off_structure -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.driver_off_structure (
  driver_id uuid NOT NULL REFERENCES public.drivers (id) ON DELETE CASCADE,
  period_month date NOT NULL,
  off_days integer NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, period_month)
);

ALTER TABLE public.driver_off_structure
  DROP CONSTRAINT IF EXISTS driver_off_structure_month_check;
ALTER TABLE public.driver_off_structure
  ADD CONSTRAINT driver_off_structure_month_check
  CHECK (period_month = date_trunc('month', period_month)::date);

ALTER TABLE public.driver_off_structure
  DROP CONSTRAINT IF EXISTS driver_off_structure_days_check;
ALTER TABLE public.driver_off_structure
  ADD CONSTRAINT driver_off_structure_days_check
  CHECK (off_days >= 0 AND off_days <= 31);

ALTER TABLE public.driver_off_structure
  DROP CONSTRAINT IF EXISTS driver_off_structure_source_check;
ALTER TABLE public.driver_off_structure
  ADD CONSTRAINT driver_off_structure_source_check
  CHECK (source IN ('manual', 'bulk_upload'));

COMMENT ON TABLE public.driver_off_structure IS
  'One row per driver per month: contracted OFF days behind Required Hours on /payroll. Absent row = 2 off days.';
COMMENT ON COLUMN public.driver_off_structure.period_month IS
  'First day of the Kuwait calendar month the off count applies to.';

CREATE INDEX IF NOT EXISTS driver_off_structure_month_idx
  ON public.driver_off_structure (period_month);

ALTER TABLE public.driver_off_structure ENABLE ROW LEVEL SECURITY;

-- Staff read; every write goes through the RPCs below so payroll.manage is a
-- lock rather than a disabled button.
DROP POLICY IF EXISTS driver_off_structure_staff_read ON public.driver_off_structure;
CREATE POLICY driver_off_structure_staff_read ON public.driver_off_structure
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

-- 3. write gate -----------------------------------------------------------

-- staff_has_permission() predates access_kind and reads role grants only, so a
-- 'user' staff member with the tick would be refused by it. Mirroring
-- hasPermissionInSet here keeps the RPC and the panel in agreement.
CREATE OR REPLACE FUNCTION public.payroll_can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.access_kind = 'manager'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions arp ON arp.role_id = p.admin_role_id
      WHERE p.id = auth.uid() AND arp.permission_slug = 'payroll.manage'
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_user_permissions up
      WHERE up.user_id = auth.uid() AND up.permission_slug = 'payroll.manage'
    );
$$;

REVOKE ALL ON FUNCTION public.payroll_can_manage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_can_manage() TO authenticated, service_role;

-- 4. single write ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_driver_off_structure(
  p_driver_id uuid,
  p_month date,
  p_off_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month date;
  v_cur_month date;
  v_days integer;
  v_name text;
  v_prev integer;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cur_month := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
  v_month := date_trunc('month', p_month)::date;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month';
  END IF;
  IF v_month < (v_cur_month - INTERVAL '2 months')::date OR v_month > v_cur_month THEN
    RAISE EXCEPTION 'month_out_of_range';
  END IF;
  v_days := ((v_month + INTERVAL '1 month')::date - v_month);

  SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), d.driver_code)
  INTO v_name
  FROM public.drivers d
  LEFT JOIN public.profiles pr ON pr.id = d.id
  WHERE d.id = p_driver_id AND d.archived_at IS NULL;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  SELECT o.off_days INTO v_prev
  FROM public.driver_off_structure o
  WHERE o.driver_id = p_driver_id AND o.period_month = v_month;

  -- NULL clears the override and returns the driver to the 2-day fallback.
  IF p_off_days IS NULL THEN
    DELETE FROM public.driver_off_structure
    WHERE driver_id = p_driver_id AND period_month = v_month;

    RETURN jsonb_build_object(
      'ok', true,
      'cleared', true,
      'driver_id', p_driver_id,
      'driver_name', v_name,
      'month', to_char(v_month, 'YYYY-MM'),
      'previous_off_days', v_prev
    );
  END IF;

  IF p_off_days < 0 THEN
    RAISE EXCEPTION 'invalid_off_days';
  END IF;
  IF p_off_days > v_days THEN
    RAISE EXCEPTION 'off_days_exceeds_month';
  END IF;

  INSERT INTO public.driver_off_structure
    (driver_id, period_month, off_days, source, updated_by, updated_at)
  VALUES (p_driver_id, v_month, p_off_days, 'manual', auth.uid(), now())
  ON CONFLICT (driver_id, period_month) DO UPDATE SET
    off_days = EXCLUDED.off_days,
    source = 'manual',
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'cleared', false,
    'driver_id', p_driver_id,
    'driver_name', v_name,
    'month', to_char(v_month, 'YYYY-MM'),
    'off_days', p_off_days,
    'previous_off_days', v_prev
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_driver_off_structure(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_driver_off_structure(uuid, date, integer) TO authenticated;

-- 5. bulk write -----------------------------------------------------------

-- p_rows: [{ "driver_key": "10840", "off_days": 2 }, ...]
--
-- driver_key resolves against drivers.driver_code (the MG "Driver ID" the page
-- and the template print) OR drivers.employee_id (the Employee Number the HR
-- report carries), because the two names collide across the SOP template and
-- the page. Two live drivers today have one's employee_id equal to another's
-- driver_code, so a key matching more than one driver is refused as
-- ambiguous_id rather than written to whichever row sorted first.
--
-- Every row is reported back with its verdict so valid rows can be applied
-- while rejected ones are re-uploaded.
CREATE OR REPLACE FUNCTION public.admin_bulk_set_driver_off_structure(
  p_month date,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month date;
  v_cur_month date;
  v_days integer;
  v_count integer;
  v_verdicts jsonb;
  v_applied integer := 0;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.payroll_can_manage() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_cur_month := date_trunc('month', (timezone('Asia/Kuwait', now()))::date)::date;
  v_month := date_trunc('month', p_month)::date;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month';
  END IF;
  IF v_month < (v_cur_month - INTERVAL '2 months')::date OR v_month > v_cur_month THEN
    RAISE EXCEPTION 'month_out_of_range';
  END IF;
  v_days := ((v_month + INTERVAL '1 month')::date - v_month);

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rows';
  END IF;

  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no_rows';
  END IF;
  IF v_count > 2000 THEN
    RAISE EXCEPTION 'too_many_rows';
  END IF;

  -- Verdicts first, write second: a data-modifying CTE may only appear at the
  -- top level of a statement, so it cannot live inside RETURN (WITH ...).
  WITH input AS (
    SELECT
      (e.ord - 1)::int AS idx,
      btrim(COALESCE(e.value->>'driver_key', e.value->>'employee_id', '')) AS driver_key,
      e.value->>'off_days' AS off_days_raw
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(value, ord)
  ),
  parsed AS (
    SELECT
      i.idx,
      i.driver_key,
      CASE
        WHEN i.off_days_raw ~ '^[[:space:]]*[0-9]+[[:space:]]*$' THEN (btrim(i.off_days_raw))::int
        ELSE NULL
      END AS off_days
    FROM input i
  ),
  matched AS (
    SELECT
      p.idx,
      p.driver_key,
      p.off_days,
      (
        SELECT COUNT(*)
        FROM public.drivers d
        WHERE d.archived_at IS NULL
          AND (
            upper(btrim(COALESCE(d.employee_id, ''))) = upper(p.driver_key)
            OR upper(btrim(COALESCE(d.driver_code, ''))) = upper(p.driver_key)
          )
      )::int AS match_count,
      (
        SELECT d.id
        FROM public.drivers d
        WHERE d.archived_at IS NULL
          AND (
            upper(btrim(COALESCE(d.employee_id, ''))) = upper(p.driver_key)
            OR upper(btrim(COALESCE(d.driver_code, ''))) = upper(p.driver_key)
          )
        ORDER BY d.created_at
        LIMIT 1
      ) AS driver_id
    FROM parsed p
  ),
  -- A repeated driver key in one sheet is rejected rather than letting the last
  -- row win silently.
  dup AS (
    SELECT upper(driver_key) AS key
    FROM matched
    WHERE driver_key <> ''
    GROUP BY upper(driver_key)
    HAVING COUNT(*) > 1
  ),
  verdict AS (
    SELECT
      m.idx,
      m.driver_key,
      m.off_days,
      m.driver_id,
      prev.off_days AS previous_off_days,
      CASE
        WHEN m.driver_key = '' THEN 'missing_id'
        WHEN EXISTS (SELECT 1 FROM dup WHERE dup.key = upper(m.driver_key)) THEN 'duplicate'
        WHEN m.off_days IS NULL THEN 'invalid_off_days'
        WHEN m.off_days < 0 THEN 'invalid_off_days'
        WHEN m.off_days > v_days THEN 'off_days_exceeds_month'
        WHEN m.match_count = 0 THEN 'unknown_id'
        WHEN m.match_count > 1 THEN 'ambiguous_id'
        ELSE 'applied'
      END AS verdict
    FROM matched m
    LEFT JOIN public.driver_off_structure prev
      ON prev.driver_id = m.driver_id AND prev.period_month = v_month
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'index', v.idx,
      'driverKey', v.driver_key,
      'offDays', v.off_days,
      'previousOffDays', v.previous_off_days,
      'verdict', v.verdict,
      'driverId', CASE WHEN v.verdict = 'applied' THEN v.driver_id ELSE NULL END,
      'driverName', CASE
        WHEN v.verdict = 'applied' THEN (
          SELECT COALESCE(NULLIF(btrim(pr.full_name), ''), d.driver_code)
          FROM public.drivers d
          LEFT JOIN public.profiles pr ON pr.id = d.id
          WHERE d.id = v.driver_id
        )
        ELSE NULL
      END
    )
    ORDER BY v.idx
  ), '[]'::jsonb)
  INTO v_verdicts
  FROM verdict v;

  INSERT INTO public.driver_off_structure
    (driver_id, period_month, off_days, source, updated_by, updated_at)
  SELECT (r->>'driverId')::uuid, v_month, (r->>'offDays')::int, 'bulk_upload', auth.uid(), now()
  FROM jsonb_array_elements(v_verdicts) AS r
  WHERE r->>'verdict' = 'applied'
  ON CONFLICT (driver_id, period_month) DO UPDATE SET
    off_days = EXCLUDED.off_days,
    source = 'bulk_upload',
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  GET DIAGNOSTICS v_applied = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'month', to_char(v_month, 'YYYY-MM'),
    'monthDays', v_days,
    'applied', v_applied,
    'skipped', v_count - v_applied,
    'rows', v_verdicts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_set_driver_off_structure(date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_driver_off_structure(date, jsonb) TO authenticated;

-- 6. snapshot: hours + off structure --------------------------------------

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
  v_default_off integer := 2;
  v_day_hours numeric := 12;
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
  v_fixed := v_days - v_default_off;

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
    -- One row per driver-day: the day is worked when a check-in exists, and the
    -- hours are check-in -> check-out with no cap. A log still open (no
    -- check-out) keeps the worked day and contributes 0 hours, because the
    -- shift has not ended yet and guessing a length would inflate the month.
    logs AS (
      SELECT
        l.driver_id,
        (timezone('Asia/Kuwait', l.check_in_at))::date AS d,
        CASE
          WHEN l.check_out_at IS NULL THEN 0::numeric
          ELSE GREATEST(
            0::numeric,
            EXTRACT(EPOCH FROM (l.check_out_at - l.check_in_at))::numeric / 3600
          )
        END AS hours
      FROM public.attendance_logs l
      WHERE l.check_in_at >= (v_month::timestamp AT TIME ZONE 'Asia/Kuwait')
        AND l.check_in_at < (v_end::timestamp AT TIME ZONE 'Asia/Kuwait')
    ),
    checkins AS (
      SELECT driver_id, d, SUM(hours) AS hours
      FROM logs
      GROUP BY driver_id, d
    ),
    off_struct AS (
      SELECT o.driver_id, o.off_days, o.source
      FROM public.driver_off_structure o
      WHERE o.period_month = v_month
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
        END AS unjustified,
        COALESCE(c.hours, 0)::numeric AS hours
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
        (COUNT(*) FILTER (WHERE cl.status = 'work') * v_day_hours)::numeric AS "totalHours",
        COUNT(*) FILTER (WHERE cl.status = 'off')::int AS "offDays",
        COUNT(*) FILTER (WHERE cl.status = 'sick')::int AS "sickDays",
        COUNT(*) FILTER (WHERE cl.status = 'accident')::int AS "accidentDays",
        COUNT(*) FILTER (WHERE cl.status = 'absent')::int AS "absentDays",
        v_fixed AS "fixedDays",
        COALESCE(os.off_days, v_default_off)::int AS "offStructureDays",
        COALESCE(os.source, 'default') AS "offStructureSource",
        (COALESCE(os.off_days, v_default_off) * v_day_hours)::numeric AS "offStructureHours",
        GREATEST(
          0::numeric,
          (v_days - COALESCE(os.off_days, v_default_off)) * v_day_hours
        ) AS "requiredHours",
        round(SUM(cl.hours), 2) AS "actualHours",
        CASE
          WHEN (v_days - COALESCE(os.off_days, v_default_off)) <= 0 THEN 0
          ELSE (
            SUM(cl.hours)
            / ((v_days - COALESCE(os.off_days, v_default_off)) * v_day_hours)
          ) * 100
        END AS efficiency,
        COUNT(*) FILTER (WHERE cl.unjustified)::int AS unjustified
      FROM roster d
      JOIN classified cl ON cl.driver_id = d.id
      LEFT JOIN off_struct os ON os.driver_id = d.id
      GROUP BY
        d.id, d.employee_id, d.driver_code, d.name, d.project_key, d.restaurant_name,
        d.restaurant_id, d.zone_name, d.zone_id, d.nationality, d.status, d.vehicle_key,
        d.rider_category, d.source_company, os.off_days, os.source
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
          'days', ((m + INTERVAL '1 month')::date - m::date),
          'label', to_char(m, 'Mon YYYY'),
          'fixedDays', ((m + INTERVAL '1 month')::date - m::date) - v_default_off
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
        'fixedDays', v_fixed,
        'defaultOffDays', v_default_off,
        'dayHours', v_day_hours
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
