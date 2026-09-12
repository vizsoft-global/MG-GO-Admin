-- Performance ops dashboard (SOP v1.0): source_company, monthly Target DPD,
-- and admin_performance_ops_snapshot. Working day = verified orders > 0.
-- Do not reuse admin_dpd_efficiency_snapshot (attendance + delivery_rules).

-- ---------------------------------------------------------------------------
-- source_company
-- ---------------------------------------------------------------------------

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS source_company text;

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS source_company text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_source_company_check;

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_source_company_check;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_source_company_check
  CHECK (
    source_company IS NULL
    OR source_company IN ('mg', 'kn', 'rvd', 'sadeeq', 'brk', 'hs', 'ar', 'zk')
  );

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_source_company_check
  CHECK (
    source_company IS NULL
    OR source_company IN ('mg', 'kn', 'rvd', 'sadeeq', 'brk', 'hs', 'ar', 'zk')
  );

CREATE INDEX IF NOT EXISTS drivers_source_company_idx
  ON public.drivers (source_company)
  WHERE source_company IS NOT NULL;

-- ---------------------------------------------------------------------------
-- monthly Target DPD (global row per Kuwait month; zone/team reserved)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.performance_target_dpd (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL,
  target numeric NOT NULL CHECK (target > 0),
  zone_id uuid REFERENCES public.zones (id) ON DELETE CASCADE,
  team_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_target_dpd_month_chk
    CHECK (month = date_trunc('month', month)::date)
);

CREATE UNIQUE INDEX IF NOT EXISTS performance_target_dpd_global_month_uidx
  ON public.performance_target_dpd (month)
  WHERE zone_id IS NULL AND team_key IS NULL;

ALTER TABLE public.performance_target_dpd ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.performance_target_dpd TO authenticated;

DROP POLICY IF EXISTS staff_select_performance_target_dpd ON public.performance_target_dpd;
CREATE POLICY staff_select_performance_target_dpd
  ON public.performance_target_dpd
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

INSERT INTO public.performance_target_dpd (month, target)
SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Kuwait'))::date, 25
WHERE NOT EXISTS (
  SELECT 1
  FROM public.performance_target_dpd t
  WHERE t.month = date_trunc('month', (now() AT TIME ZONE 'Asia/Kuwait'))::date
    AND t.zone_id IS NULL
    AND t.team_key IS NULL
);

-- ---------------------------------------------------------------------------
-- admin_approve_driver copies source_company
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_approve_driver(
  p_intake_id uuid,
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intake public.driver_intakes%ROWTYPE;
  v_passcode text;
  v_avatar text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_user_id IS NULL OR p_intake_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  SELECT * INTO v_intake
  FROM public.driver_intakes
  WHERE id = p_intake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  IF v_intake.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_archived');
  END IF;

  IF v_intake.linked = true OR v_intake.linked_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  IF v_intake.full_name IS NULL OR trim(v_intake.full_name) = ''
     OR v_intake.employee_id IS NULL OR trim(v_intake.employee_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields');
  END IF;

  IF NOT public.intake_has_ops_assignment(p_intake_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_missing_assignment');
  END IF;

  IF v_intake.phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.phone = v_intake.phone AND p.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
  END IF;

  IF v_intake.civil_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.civil_id = v_intake.civil_id AND d.id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
  END IF;

  IF EXISTS (SELECT 1 FROM public.drivers WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_already_linked');
  END IF;

  v_avatar := NULLIF(btrim(COALESCE(v_intake.avatar_url, '')), '');

  INSERT INTO public.profiles (
    id, email, full_name, phone, role, locale, approval_status, avatar_url
  )
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    v_intake.full_name,
    v_intake.phone,
    'rider'::public.app_role,
    'en',
    'approved'::public.admin_approval_status,
    v_avatar
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = 'rider'::public.app_role,
    approval_status = 'approved'::public.admin_approval_status,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  INSERT INTO public.drivers (
    id,
    driver_code,
    partner_id,
    zone_id,
    vehicle_id,
    civil_id,
    employee_id,
    nationality,
    rider_category,
    client_id,
    client_name,
    project_key,
    accommodation,
    source_company,
    custom_fields,
    status,
    is_on_duty,
    avatar_object_key,
    avatar_updated_at
  )
  VALUES (
    p_user_id,
    v_intake.driver_code,
    v_intake.partner_id,
    v_intake.zone_id,
    v_intake.vehicle_id,
    v_intake.civil_id,
    v_intake.employee_id,
    v_intake.nationality,
    v_intake.rider_category,
    v_intake.client_id,
    v_intake.client_name,
    v_intake.project_key,
    v_intake.accommodation,
    v_intake.source_company,
    COALESCE(v_intake.custom_fields, '{}'::jsonb),
    'pending'::public.driver_status,
    false,
    v_avatar,
    CASE WHEN v_avatar IS NOT NULL THEN now() ELSE NULL END
  );

  INSERT INTO public.driver_restaurants (driver_id, restaurant_id)
  SELECT p_user_id, dir.restaurant_id
  FROM public.driver_intake_restaurants dir
  WHERE dir.intake_id = p_intake_id
  ON CONFLICT DO NOTHING;

  PERFORM public.sync_intake_asset_assignments_to_driver(p_intake_id, p_user_id);

  UPDATE public.drivers
  SET status = 'active'::public.driver_status, updated_at = now()
  WHERE id = p_user_id;

  SELECT app_passcode INTO v_passcode
  FROM public.drivers
  WHERE id = p_user_id;

  UPDATE public.driver_intakes
  SET
    linked = true,
    linked_profile_id = p_user_id,
    workflow_status = 'approved'::public.driver_workflow_status,
    status = 'linked'::public.driver_intake_status,
    updated_at = now()
  WHERE id = p_intake_id;

  UPDATE public.document_tracking
  SET driver_id = p_user_id, updated_at = now()
  WHERE intake_id = p_intake_id;

  UPDATE public.driver_documents dd
  SET
    expires_at = dt.expires_at,
    updated_at = now()
  FROM public.document_tracking dt
  WHERE dt.driver_id = p_user_id
    AND dt.doc_type = dd.doc_type
    AND dt.track_expiry = true
    AND dt.expires_at IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'driver_id', p_user_id,
    'driver_code', v_intake.driver_code,
    'app_passcode', v_passcode
  );
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%employee_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'employee_id_exists');
    END IF;
    IF SQLERRM LIKE '%civil_id%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'civil_id_exists');
    END IF;
    IF SQLERRM LIKE '%phone%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_exists');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'save_failed');
END;
$$;

-- ---------------------------------------------------------------------------
-- Target DPD helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_performance_target_dpd()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'month', t.month,
        'target', t.target
      ) ORDER BY t.month DESC)
      FROM public.performance_target_dpd t
      WHERE t.zone_id IS NULL AND t.team_key IS NULL
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_performance_target_dpd(
  p_month date,
  p_target numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month date;
  v_id uuid;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_target IS NULL OR p_target <= 0 THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  v_month := date_trunc('month', p_month)::date;

  UPDATE public.performance_target_dpd
  SET target = p_target, updated_at = now()
  WHERE month = v_month AND zone_id IS NULL AND team_key IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.performance_target_dpd (month, target)
    VALUES (v_month, p_target)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'month', v_month, 'target', p_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_performance_ops_bounds()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first date;
  v_today date;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  SELECT MIN((timezone('Asia/Kuwait', d.delivered_at))::date)
    INTO v_first
  FROM public.deliveries d
  WHERE d.status = 'verified' AND d.delivered_at IS NOT NULL;

  RETURN jsonb_build_object(
    'today', v_today,
    'first_delivery_date', v_first,
    'span_days', CASE
      WHEN v_first IS NULL THEN 0
      ELSE (v_today - v_first) + 1
    END,
    'over_cap', CASE
      WHEN v_first IS NULL THEN false
      ELSE ((v_today - v_first) + 1) > 400
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot — SOP formulas + locked assumptions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_performance_ops_snapshot(
  p_from date,
  p_to date,
  p_project_keys text[] DEFAULT NULL,
  p_zone_ids uuid[] DEFAULT NULL,
  p_vehicle_keys text[] DEFAULT NULL,
  p_nationalities text[] DEFAULT NULL,
  p_source_types text[] DEFAULT NULL,
  p_source_companies text[] DEFAULT NULL,
  p_restaurant_ids uuid[] DEFAULT NULL,
  p_outsource_only boolean DEFAULT false,
  p_granularity text DEFAULT 'daily'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from date;
  v_to date;
  v_prev_from date;
  v_prev_to date;
  v_n integer;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_target numeric;
  v_mode text;
  v_gran text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_from := p_from;
  v_to := p_to;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
    RAISE EXCEPTION 'invalid_date_range';
  END IF;
  IF (v_to - v_from) + 1 > 400 THEN
    RAISE EXCEPTION 'range_too_large';
  END IF;

  v_n := (v_to - v_from) + 1;
  v_prev_to := v_from - 1;
  v_prev_from := v_from - v_n;
  v_start := (v_prev_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_end := ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  v_prev_start := v_start;

  v_gran := CASE
    WHEN p_granularity IN ('daily', 'weekly', 'monthly') THEN p_granularity
    ELSE 'daily'
  END;

  v_mode := CASE
    WHEN p_project_keys IS NULL OR cardinality(p_project_keys) = 0 THEN 'all'
    WHEN 'americana' = ANY (p_project_keys) AND 'keeta' = ANY (p_project_keys) THEN 'all'
    WHEN 'americana' = ANY (p_project_keys) AND NOT ('keeta' = ANY (p_project_keys)) THEN 'americana'
    WHEN 'keeta' = ANY (p_project_keys) AND NOT ('americana' = ANY (p_project_keys)) THEN 'keeta'
    ELSE 'all'
  END;

  SELECT t.target INTO v_target
  FROM public.performance_target_dpd t
  WHERE t.zone_id IS NULL
    AND t.team_key IS NULL
    AND t.month <= date_trunc('month', v_to)::date
  ORDER BY t.month DESC
  LIMIT 1;
  v_target := COALESCE(v_target, 25);

  RETURN (
    WITH store_map AS (
      SELECT DISTINCT ON (dr.driver_id)
        dr.driver_id,
        dr.restaurant_id
      FROM public.driver_restaurants dr
      ORDER BY dr.driver_id, dr.restaurant_id ASC
    ),
    roster AS (
      SELECT
        d.id,
        COALESCE(p.full_name, '—') AS name,
        d.employee_id,
        d.driver_code,
        d.zone_id,
        z.name AS zone_name,
        d.project_key,
        d.nationality,
        d.rider_category,
        d.source_company,
        d.archived_at,
        sm.restaurant_id AS store_id,
        CASE
          WHEN d.project_key = 'keeta' THEN NULL
          ELSE r.name
        END AS store_name,
        CASE
          WHEN d.vehicle_id IS NULL THEN NULL
          ELSE v.vehicle_type_key
        END AS vehicle_key
      FROM public.drivers d
      LEFT JOIN public.profiles p ON p.id = d.id
      LEFT JOIN public.zones z ON z.id = d.zone_id
      LEFT JOIN store_map sm ON sm.driver_id = d.id
      LEFT JOIN public.restaurants r ON r.id = sm.restaurant_id
      LEFT JOIN public.vehicles v ON v.id = d.vehicle_id
      WHERE (d.archived_at IS NULL OR d.archived_at >= (v_from::timestamp AT TIME ZONE 'Asia/Kuwait'))
        AND (
          NOT COALESCE(p_outsource_only, false)
          OR d.rider_category = 'outsourced'
        )
        AND (
          p_project_keys IS NULL OR cardinality(p_project_keys) = 0
          OR d.project_key = ANY (p_project_keys)
        )
        AND (
          p_zone_ids IS NULL OR cardinality(p_zone_ids) = 0
          OR d.zone_id = ANY (p_zone_ids)
        )
        AND (
          p_vehicle_keys IS NULL OR cardinality(p_vehicle_keys) = 0
          OR (d.vehicle_id IS NOT NULL AND v.vehicle_type_key = ANY (p_vehicle_keys))
        )
        AND (
          p_nationalities IS NULL OR cardinality(p_nationalities) = 0
          OR d.nationality = ANY (p_nationalities)
        )
        AND (
          COALESCE(p_outsource_only, false)
          OR p_source_types IS NULL OR cardinality(p_source_types) = 0
          OR d.rider_category = ANY (p_source_types)
        )
        AND (
          p_source_companies IS NULL OR cardinality(p_source_companies) = 0
          OR d.source_company = ANY (p_source_companies)
        )
        AND (
          p_restaurant_ids IS NULL OR cardinality(p_restaurant_ids) = 0
          OR sm.restaurant_id = ANY (p_restaurant_ids)
        )
    ),
    daily AS (
      SELECT
        del.driver_id,
        (timezone('Asia/Kuwait', del.delivered_at))::date AS day,
        COUNT(*)::integer AS orders
      FROM public.deliveries del
      WHERE del.status = 'verified'
        AND del.delivered_at IS NOT NULL
        AND del.delivered_at >= v_prev_start
        AND del.delivered_at < v_end
        AND del.driver_id IN (SELECT id FROM roster)
      GROUP BY 1, 2
    ),
    rider_cur AS (
      SELECT
        r.*,
        COALESCE(SUM(d.orders) FILTER (WHERE d.day BETWEEN v_from AND v_to), 0)::integer AS orders,
        COUNT(*) FILTER (WHERE d.day BETWEEN v_from AND v_to AND d.orders > 0)::integer AS working_days
      FROM roster r
      LEFT JOIN daily d ON d.driver_id = r.id
      GROUP BY
        r.id, r.name, r.employee_id, r.driver_code, r.zone_id, r.zone_name,
        r.project_key, r.nationality, r.rider_category, r.source_company,
        r.archived_at, r.store_id, r.store_name, r.vehicle_key
    ),
    rider_prev AS (
      SELECT
        r.id,
        COALESCE(SUM(d.orders) FILTER (WHERE d.day BETWEEN v_prev_from AND v_prev_to), 0)::integer AS orders,
        COUNT(*) FILTER (WHERE d.day BETWEEN v_prev_from AND v_prev_to AND d.orders > 0)::integer AS working_days
      FROM roster r
      LEFT JOIN daily d ON d.driver_id = r.id
      GROUP BY r.id
    ),
    store_stats AS (
      SELECT
        c.store_id,
        MIN(c.store_name) AS store_name,
        MIN(c.zone_id) AS zone_id,
        MIN(c.zone_name) AS zone_name,
        SUM(c.orders)::integer AS orders,
        SUM(c.working_days)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE c.working_days > 0)::integer AS active_riders,
        CASE
          WHEN SUM(c.working_days) > 0 THEN SUM(c.orders)::numeric / SUM(c.working_days)
          ELSE NULL
        END AS store_dpd
      FROM rider_cur c
      WHERE c.store_id IS NOT NULL AND c.project_key IS DISTINCT FROM 'keeta'
      GROUP BY c.store_id
    ),
    zv_stats AS (
      SELECT
        c.zone_id,
        c.vehicle_key,
        SUM(c.orders)::integer AS orders,
        SUM(c.working_days)::integer AS working_days,
        CASE
          WHEN SUM(c.working_days) > 0 THEN SUM(c.orders)::numeric / SUM(c.working_days)
          ELSE NULL
        END AS zv_dpd
      FROM rider_cur c
      WHERE c.vehicle_key IS NOT NULL AND c.zone_id IS NOT NULL
      GROUP BY c.zone_id, c.vehicle_key
    ),
    scored AS (
      SELECT
        c.*,
        CASE WHEN c.working_days > 0 THEN c.orders::numeric / c.working_days ELSE NULL END AS dpd,
        ss.store_dpd,
        zv.zv_dpd,
        CASE v_mode
          WHEN 'americana' THEN ss.store_dpd
          WHEN 'keeta' THEN zv.zv_dpd
          ELSE CASE
            WHEN ss.store_dpd IS NOT NULL AND zv.zv_dpd IS NOT NULL
              THEN (ss.store_dpd + zv.zv_dpd) / 2
            ELSE COALESCE(ss.store_dpd, zv.zv_dpd)
          END
        END AS benchmark,
        v_target AS target_dpd
      FROM rider_cur c
      LEFT JOIN store_stats ss ON ss.store_id = c.store_id
      LEFT JOIN zv_stats zv
        ON zv.zone_id = c.zone_id AND zv.vehicle_key = c.vehicle_key
    ),
    scored2 AS (
      SELECT
        s.*,
        CASE
          WHEN s.dpd IS NOT NULL AND s.benchmark IS NOT NULL AND s.benchmark > 0
            THEN (s.dpd / s.benchmark) * 100
          ELSE NULL
        END AS dpd_eff,
        CASE
          WHEN s.dpd IS NOT NULL AND s.target_dpd > 0
            THEN (s.dpd / s.target_dpd) * 100
          ELSE NULL
        END AS tgt_eff
      FROM scored s
    ),
    prev_tot AS (
      SELECT
        COALESCE(SUM(p.orders), 0)::integer AS orders,
        COALESCE(SUM(p.working_days), 0)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE p.working_days > 0)::integer AS active
      FROM rider_prev p
    ),
    cur_tot AS (
      SELECT
        COALESCE(SUM(s.orders), 0)::integer AS orders,
        COALESCE(SUM(s.working_days), 0)::integer AS working_days,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active,
        CASE
          WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days)
          ELSE NULL
        END AS overall_dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS avg_dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS avg_tgt_eff
      FROM scored2 s
    ),
    prev_scored AS (
      SELECT
        CASE
          WHEN SUM(p.working_days) > 0 THEN SUM(p.orders)::numeric / SUM(p.working_days)
          ELSE NULL
        END AS overall_dpd
      FROM rider_prev p
    ),
    prev_eff AS (
      SELECT
        AVG(x.dpd_eff) AS avg_dpd_eff,
        AVG(x.tgt_eff) AS avg_tgt_eff
      FROM (
        SELECT
          CASE
            WHEN p.working_days > 0 AND b.benchmark IS NOT NULL AND b.benchmark > 0
              THEN ((p.orders::numeric / p.working_days) / b.benchmark) * 100
            ELSE NULL
          END AS dpd_eff,
          CASE
            WHEN p.working_days > 0 AND v_target > 0
              THEN ((p.orders::numeric / p.working_days) / v_target) * 100
            ELSE NULL
          END AS tgt_eff
        FROM rider_prev p
        JOIN scored2 b ON b.id = p.id
      ) x
    ),
    store_vs AS (
      SELECT
        COUNT(*) FILTER (WHERE store_dpd >= v_target)::integer AS above,
        COUNT(*) FILTER (WHERE store_dpd IS NOT NULL AND store_dpd < v_target)::integer AS below
      FROM store_stats
    ),
    buckets AS (
      SELECT
        d.day,
        CASE v_gran
          WHEN 'weekly' THEN date_trunc('week', d.day)::date
          WHEN 'monthly' THEN date_trunc('month', d.day)::date
          ELSE d.day
        END AS bucket,
        SUM(d.orders)::integer AS orders,
        COUNT(*) FILTER (WHERE d.orders > 0)::integer AS working_days
      FROM daily d
      WHERE d.day BETWEEN v_from AND v_to
      GROUP BY 1, 2
    ),
    trend AS (
      SELECT
        bucket,
        SUM(orders)::integer AS orders,
        SUM(working_days)::integer AS working_days,
        CASE
          WHEN SUM(working_days) > 0 THEN SUM(orders)::numeric / SUM(working_days)
          ELSE NULL
        END AS dpd
      FROM buckets
      GROUP BY bucket
    ),
    dim_vehicle AS (
      SELECT
        s.vehicle_key AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      WHERE s.vehicle_key IS NOT NULL
      GROUP BY s.vehicle_key
    ),
    dim_zone AS (
      SELECT
        s.zone_id AS id,
        COALESCE(s.zone_name, '—') AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active_riders,
        COUNT(*) FILTER (WHERE s.vehicle_key = 'bike')::integer AS bikes,
        COUNT(*) FILTER (WHERE s.vehicle_key = 'car')::integer AS cars
      FROM scored2 s
      GROUP BY s.zone_id, s.zone_name
    ),
    dim_partner AS (
      SELECT
        COALESCE(s.project_key, '—') AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      GROUP BY s.project_key
    ),
    dim_nat AS (
      SELECT
        COALESCE(s.nationality, '—') AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders
      FROM scored2 s
      GROUP BY s.nationality
    ),
    dim_company AS (
      SELECT
        COALESCE(s.source_company, '—') AS key,
        SUM(s.orders)::integer AS orders,
        SUM(s.working_days)::integer AS working_days,
        CASE WHEN SUM(s.working_days) > 0 THEN SUM(s.orders)::numeric / SUM(s.working_days) ELSE NULL END AS dpd,
        AVG(s.dpd_eff) FILTER (WHERE s.working_days > 0) AS dpd_eff,
        AVG(s.tgt_eff) FILTER (WHERE s.working_days > 0) AS tgt_eff,
        COUNT(*)::integer AS riders,
        COUNT(*) FILTER (WHERE s.working_days > 0)::integer AS active_riders
      FROM scored2 s
      GROUP BY s.source_company
    ),
    options AS (
      SELECT jsonb_build_object(
        'zones', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) ORDER BY z.name)
          FROM public.zones z
        ), '[]'::jsonb),
        'restaurants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
          FROM public.restaurants r
          WHERE r.is_active = true
        ), '[]'::jsonb),
        'nationalities', COALESCE((
          SELECT jsonb_agg(x ORDER BY x)
          FROM (
            SELECT DISTINCT d.nationality AS x
            FROM public.drivers d
            WHERE d.archived_at IS NULL AND d.nationality IS NOT NULL
          ) q
        ), '[]'::jsonb)
      ) AS payload
    )
    SELECT jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'prev_from', v_prev_from,
      'prev_to', v_prev_to,
      'target_dpd', v_target,
      'partner_mode', v_mode,
      'kpis', jsonb_build_object(
        'orders', (SELECT orders FROM cur_tot),
        'orders_prev', (SELECT orders FROM prev_tot),
        'overall_dpd', (SELECT overall_dpd FROM cur_tot),
        'overall_dpd_prev', (SELECT overall_dpd FROM prev_scored),
        'avg_dpd_eff', (SELECT avg_dpd_eff FROM cur_tot),
        'avg_dpd_eff_prev', (SELECT avg_dpd_eff FROM prev_eff),
        'avg_tgt_eff', (SELECT avg_tgt_eff FROM cur_tot),
        'avg_tgt_eff_prev', (SELECT avg_tgt_eff FROM prev_eff),
        'riders', (SELECT riders FROM cur_tot),
        'riders_prev', (SELECT riders FROM prev_tot),
        'active', (SELECT active FROM cur_tot),
        'active_prev', (SELECT active FROM prev_tot),
        'working_days', (SELECT working_days FROM cur_tot),
        'stores_above', (SELECT above FROM store_vs),
        'stores_below', (SELECT below FROM store_vs)
      ),
      'trend', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bucket', t.bucket,
          'orders', t.orders,
          'working_days', t.working_days,
          'dpd', t.dpd,
          'dpd_eff', CASE
            WHEN t.dpd IS NOT NULL AND c.overall_dpd IS NOT NULL AND c.overall_dpd > 0
              THEN (t.dpd / NULLIF(c.overall_dpd, 0)) * COALESCE(c.avg_dpd_eff, 0)
            ELSE NULL
          END,
          'tgt_eff', CASE
            WHEN t.dpd IS NOT NULL AND v_target > 0 THEN (t.dpd / v_target) * 100
            ELSE NULL
          END
        ) ORDER BY t.bucket)
        FROM trend t
        CROSS JOIN cur_tot c
      ), '[]'::jsonb),
      'by_vehicle', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_vehicle d), '[]'::jsonb),
      'by_zone', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_zone d), '[]'::jsonb),
      'by_partner', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_partner d), '[]'::jsonb),
      'by_nationality', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_nat d), '[]'::jsonb),
      'by_company', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.key) FROM dim_company d), '[]'::jsonb),
      'stores', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.store_name) FROM store_stats s), '[]'::jsonb),
      'riders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'driver_id', s.id,
          'name', s.name,
          'employee_id', s.employee_id,
          'driver_code', s.driver_code,
          'zone_id', s.zone_id,
          'zone', s.zone_name,
          'vehicle_key', s.vehicle_key,
          'nationality', s.nationality,
          'project_key', s.project_key,
          'store_id', s.store_id,
          'store', s.store_name,
          'source_type', s.rider_category,
          'source_company', s.source_company,
          'orders', s.orders,
          'working_days', s.working_days,
          'dpd', s.dpd,
          'target_dpd', s.target_dpd,
          'store_dpd', s.store_dpd,
          'veh_zone_dpd', s.zv_dpd,
          'dpd_eff', s.dpd_eff,
          'tgt_eff', s.tgt_eff,
          'status', CASE WHEN s.working_days > 0 THEN 'Active' ELSE 'Inactive' END
        ) ORDER BY s.name)
        FROM scored2 s
      ), '[]'::jsonb),
      'options', (SELECT payload FROM options)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_performance_target_dpd() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_performance_target_dpd(date, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_performance_ops_bounds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_performance_ops_snapshot(date, date, text[], uuid[], text[], text[], text[], text[], uuid[], boolean, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_performance_target_dpd() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_performance_target_dpd(date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_performance_ops_bounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_performance_ops_snapshot(date, date, text[], uuid[], text[], text[], text[], text[], uuid[], boolean, text) TO authenticated;
