-- Driver device inventory + per-driver force update.
-- Extends driver_device_sessions with a heartbeat-updated device_meta blob,
-- adds drivers.force_app_update_* for targeting one rider, and staff RPCs for
-- the /driver-devices admin module.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.driver_device_sessions
  ADD COLUMN IF NOT EXISTS device_meta jsonb,
  ADD COLUMN IF NOT EXISTS device_meta_at timestamptz;

COMMENT ON COLUMN public.driver_device_sessions.device_meta IS
  'Allow-listed device profile from the driver app (RAM, SoC, battery health, …).';
COMMENT ON COLUMN public.driver_device_sessions.device_meta_at IS
  'When device_meta was last written by login or driver_report_device_meta.';

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS force_app_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS force_app_update_min_code integer,
  ADD COLUMN IF NOT EXISTS force_app_update_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.drivers.force_app_update_at IS
  'When set, this rider must update before login/home continues. Cleared when reported build >= force_app_update_min_code.';

CREATE INDEX IF NOT EXISTS drivers_force_app_update_at_idx
  ON public.drivers (force_app_update_at)
  WHERE force_app_update_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Allow-list sanitiser for device_meta
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._device_meta_sanitize(p_meta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
  v_num numeric;
  v_arr jsonb;
  v_item text;
  v_items text[] := ARRAY[]::text[];
  v_allowed text[] := ARRAY[
    'model', 'manufacturer', 'brand', 'hardware', 'board',
    'soc_model', 'soc_manufacturer', 'cpu_cores',
    'ram_total_mb', 'ram_free_mb', 'is_low_ram',
    'os_version', 'android_sdk_int', 'android_security_patch',
    'supported_abis', 'is_physical_device',
    'battery_pct', 'battery_health', 'battery_temp_c', 'charging_state',
    'app_version_name', 'app_version_code', 'locale', 'collected_at'
  ];
BEGIN
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOREACH v_key IN ARRAY v_allowed LOOP
    IF NOT (p_meta ? v_key) THEN
      CONTINUE;
    END IF;
    v_val := p_meta -> v_key;
    IF v_val IS NULL OR v_val = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    IF v_key = 'supported_abis' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        CONTINUE;
      END IF;
      v_items := ARRAY[]::text[];
      FOR v_arr IN SELECT value FROM jsonb_array_elements(v_val) LOOP
        IF jsonb_typeof(v_arr) = 'string' THEN
          v_item := left(btrim(v_arr #>> '{}'), 32);
          IF v_item <> '' AND cardinality(v_items) < 8 THEN
            v_items := array_append(v_items, v_item);
          END IF;
        END IF;
      END LOOP;
      IF cardinality(v_items) > 0 THEN
        v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_items));
      END IF;
      CONTINUE;
    END IF;

    IF v_key IN ('is_low_ram', 'is_physical_device') THEN
      IF jsonb_typeof(v_val) = 'boolean' THEN
        v_out := v_out || jsonb_build_object(v_key, v_val);
      END IF;
      CONTINUE;
    END IF;

    IF v_key IN (
      'cpu_cores', 'ram_total_mb', 'ram_free_mb',
      'android_sdk_int', 'battery_pct', 'app_version_code'
    ) THEN
      IF jsonb_typeof(v_val) = 'number' THEN
        v_num := (v_val #>> '{}')::numeric;
        IF v_num = trunc(v_num) AND v_num >= 0 AND v_num < 100000000 THEN
          v_out := v_out || jsonb_build_object(v_key, trunc(v_num)::int);
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF v_key = 'battery_temp_c' THEN
      IF jsonb_typeof(v_val) = 'number' THEN
        v_num := (v_val #>> '{}')::numeric;
        IF v_num > -50 AND v_num < 120 THEN
          v_out := v_out || jsonb_build_object(v_key, round(v_num, 1));
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_val) = 'string' THEN
      v_text := left(btrim(v_val #>> '{}'), 120);
      IF v_text <> '' AND lower(v_text) NOT IN ('unknown', 'null') THEN
        IF v_key = 'battery_health' THEN
          v_text := lower(v_text);
          IF v_text NOT IN (
            'good', 'overheat', 'dead', 'over_voltage', 'cold', 'failure', 'unknown'
          ) THEN
            CONTINUE;
          END IF;
        END IF;
        IF v_key = 'charging_state' THEN
          v_text := lower(v_text);
          IF v_text NOT IN ('charging', 'full', 'discharging', 'unknown') THEN
            CONTINUE;
          END IF;
        END IF;
        v_out := v_out || jsonb_build_object(v_key, v_text);
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._device_meta_sanitize(jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- driver_report_device_meta — heartbeat (never raises)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_report_device_meta(
  p_device_id text,
  p_meta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_device_id text := nullif(btrim(COALESCE(p_device_id, '')), '');
  v_meta jsonb;
  v_code int;
  v_name text;
  v_updated boolean := false;
  v_force_at timestamptz;
  v_force_min int;
  v_force jsonb := NULL;
BEGIN
  IF v_uid IS NULL OR v_device_id IS NULL THEN
    RETURN jsonb_build_object('updated', false);
  END IF;

  v_meta := public._device_meta_sanitize(p_meta);
  v_code := NULLIF(v_meta ->> 'app_version_code', '')::int;
  v_name := nullif(v_meta ->> 'app_version_name', '');

  UPDATE public.driver_device_sessions s
  SET
    app_version_code = COALESCE(v_code, s.app_version_code),
    app_version_name = COALESCE(v_name, s.app_version_name),
    device_model = COALESCE(nullif(v_meta ->> 'model', ''), s.device_model),
    device_manufacturer = COALESCE(nullif(v_meta ->> 'manufacturer', ''), s.device_manufacturer),
    os_version = COALESCE(nullif(v_meta ->> 'os_version', ''), s.os_version),
    android_sdk_int = COALESCE(
      NULLIF(v_meta ->> 'android_sdk_int', '')::int,
      s.android_sdk_int
    ),
    device_meta = CASE WHEN v_meta = '{}'::jsonb THEN s.device_meta ELSE v_meta END,
    device_meta_at = CASE WHEN v_meta = '{}'::jsonb THEN s.device_meta_at ELSE now() END,
    last_seen_at = now(),
    updated_at = now()
  WHERE s.driver_id = v_uid
    AND s.device_id = v_device_id
    AND s.revoked_at IS NULL;

  v_updated := FOUND;

  SELECT d.force_app_update_at, d.force_app_update_min_code
  INTO v_force_at, v_force_min
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF v_force_at IS NOT NULL AND v_force_min IS NOT NULL THEN
    IF v_code IS NOT NULL AND v_code >= v_force_min THEN
      UPDATE public.drivers
      SET
        force_app_update_at = NULL,
        force_app_update_min_code = NULL,
        force_app_update_by = NULL
      WHERE id = v_uid;
    ELSE
      v_force := jsonb_build_object(
        'min_version_code', v_force_min,
        'message', COALESCE(
          (SELECT driver_app_update_message FROM public.app_settings WHERE id = 1),
          'A new version of the app is required to continue.'
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'force_update', v_force
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('updated', false);
END;
$$;

COMMENT ON FUNCTION public.driver_report_device_meta(text, jsonb) IS
  'Heartbeat: refresh the caller''s active device session build + device_meta. Never raises.';

REVOKE ALL ON FUNCTION public.driver_report_device_meta(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_report_device_meta(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- admin_list_driver_devices — fleet inventory (no pagination; ~90 rows)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_driver_devices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_min_code int;
  v_min_name text;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    s.driver_app_min_version_code,
    s.driver_app_min_version_name
  INTO v_min_code, v_min_name
  FROM public.app_settings s
  WHERE s.id = 1;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.driver_code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id AS driver_id,
      d.driver_code,
      d.employee_id,
      pr.full_name,
      pr.phone,
      d.status::text AS status,
      d.is_on_duty,
      d.is_blocked,
      d.avatar_object_key,
      d.zone_id,
      z.name AS zone_name,
      d.active_device_id,
      s.id AS session_id,
      s.device_model,
      s.device_manufacturer,
      s.os_version,
      s.android_sdk_int,
      s.app_version_name,
      s.app_version_code,
      s.device_meta,
      s.device_meta_at,
      s.last_seen_at,
      s.first_seen_at,
      d.force_app_update_at,
      d.force_app_update_min_code
    FROM public.drivers d
    JOIN public.profiles pr ON pr.id = d.id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    LEFT JOIN public.driver_device_sessions s
      ON s.driver_id = d.id
     AND s.device_id = d.active_device_id
     AND s.revoked_at IS NULL
    WHERE d.archived_at IS NULL
  ) t;

  RETURN jsonb_build_object(
    'min_version_code', v_min_code,
    'min_version_name', v_min_name,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_driver_devices() IS
  'One row per non-archived driver with active device session + device_meta. Staff only.';

REVOKE ALL ON FUNCTION public.admin_list_driver_devices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_driver_devices() TO authenticated;

-- ---------------------------------------------------------------------------
-- admin_set_driver_force_update
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_driver_force_update(
  p_driver_ids uuid[],
  p_min_code integer,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_driver_ids IS NULL OR cardinality(p_driver_ids) = 0 THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;

  IF COALESCE(p_enabled, false) THEN
    IF p_min_code IS NULL OR p_min_code < 1 THEN
      RAISE EXCEPTION 'invalid_min_code' USING ERRCODE = '22023';
    END IF;

    UPDATE public.drivers d
    SET
      force_app_update_at = now(),
      force_app_update_min_code = p_min_code,
      force_app_update_by = v_uid
    WHERE d.id = ANY (p_driver_ids)
      AND d.archived_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    UPDATE public.drivers d
    SET
      force_app_update_at = NULL,
      force_app_update_min_code = NULL,
      force_app_update_by = NULL
    WHERE d.id = ANY (p_driver_ids)
      AND d.force_app_update_at IS NOT NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('updated', v_count, 'enabled', COALESCE(p_enabled, false));
END;
$$;

COMMENT ON FUNCTION public.admin_set_driver_force_update(uuid[], integer, boolean) IS
  'Staff: set or clear per-driver force_app_update_* for selected drivers.';

REVOKE ALL ON FUNCTION public.admin_set_driver_force_update(uuid[], integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_driver_force_update(uuid[], integer, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Home dashboard: expose per-driver force flag
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.driver_get_home_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_today date;
  v_week_start date;
  v_week_end date;
  v_driver jsonb;
  v_session jsonb;
  v_week jsonb;
  v_incentive jsonb := 'null'::jsonb;
  v_rules jsonb := '[]'::jsonb;
  v_rule record;
  v_eligible int;
  v_progress int;
  v_target int;
  v_remaining int;
  v_reward numeric(10, 3);
  v_tiers jsonb;
  v_earnings numeric(10, 3);
  v_deliveries int;
  v_online_seconds bigint;
  v_is_online boolean := false;
  v_went_online_at timestamptz;
  v_speed_mps numeric(8, 3);
  v_distance_today_meters numeric(12, 2);
  v_shift_adherence jsonb;
  v_performance jsonb;
  v_banner jsonb;
  v_force_at timestamptz;
  v_force_min int;
  v_force_app_update boolean := false;
BEGIN
  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_driver_id) THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_week_start := public.kuwait_week_start(v_today);
  v_week_end := v_today;

  SELECT jsonb_build_object(
    'full_name', COALESCE(pr.full_name, 'Driver'),
    'is_on_duty', dr.is_on_duty,
    'partner_name', pt.name,
    'partner_logo_url', pt.logo_url
  ),
  dr.force_app_update_at,
  dr.force_app_update_min_code
  INTO v_driver, v_force_at, v_force_min
  FROM public.drivers dr
  JOIN public.profiles pr ON pr.id = dr.id
  LEFT JOIN public.partners pt ON pt.id = dr.partner_id
  WHERE dr.id = v_driver_id;

  v_force_app_update := v_force_at IS NOT NULL AND v_force_min IS NOT NULL;

  SELECT ds.is_online, ds.went_online_at
  INTO v_is_online, v_went_online_at
  FROM public.driver_sessions ds
  WHERE ds.driver_id = v_driver_id
  ORDER BY ds.updated_at DESC NULLS LAST, ds.created_at DESC
  LIMIT 1;

  v_is_online := COALESCE(v_is_online, false);

  SELECT dl.speed_mps, dl.distance_today_meters
  INTO v_speed_mps, v_distance_today_meters
  FROM public.driver_locations dl
  WHERE dl.driver_id = v_driver_id;

  v_session := jsonb_build_object(
    'is_online', v_is_online,
    'went_online_at', v_went_online_at,
    'speed_mps', v_speed_mps,
    'distance_today_meters', COALESCE(v_distance_today_meters, 0)
  );

  SELECT COALESCE(SUM(w.amount_kwd), 0)
  INTO v_earnings
  FROM public.driver_wallet_entries w
  WHERE w.driver_id = v_driver_id
    AND w.status = 'approved'
    AND w.entry_type = 'earning_credit'
    AND w.earn_date BETWEEN v_week_start AND v_week_end;

  SELECT count(*)::int
  INTO v_deliveries
  FROM public.deliveries d
  WHERE d.driver_id = v_driver_id
    AND d.status IN ('in_transit', 'pending', 'under_review', 'verified')
    AND COALESCE(
      (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
      (d.pickup_at AT TIME ZONE 'Asia/Kuwait')::date
    ) BETWEEN v_week_start AND v_week_end;

  v_online_seconds := public.driver_week_online_seconds(
    v_driver_id,
    v_week_start,
    v_today
  );

  v_week := jsonb_build_object(
    'start_date', v_week_start,
    'end_date', v_week_end,
    'earnings_kwd', v_earnings,
    'deliveries_count', v_deliveries,
    'online_seconds', v_online_seconds
  );

  SELECT ir.*
  INTO v_rule
  FROM public.incentive_rules ir
  WHERE ir.status = 'active'
    AND ir.period = 'weekly'
    AND v_today BETWEEN ir.start_date AND ir.end_date
    AND public.incentive_rule_matches_driver(ir.id, v_driver_id)
  ORDER BY ir.priority DESC, ir.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    v_eligible := public.count_eligible_deliveries(v_driver_id, v_today, v_rule.id);
    v_progress := public.count_progress_deliveries(v_driver_id, v_today, v_rule.id);

    IF v_rule.target_mode = 'tiered' THEN
      SELECT COALESCE(max(t.threshold_deliveries), v_rule.base_minimum_deliveries, 0)
      INTO v_target
      FROM public.incentive_rule_tiers t
      WHERE t.incentive_rule_id = v_rule.id;
    ELSE
      v_target := COALESCE(v_rule.target_deliveries, 0);
    END IF;

    v_remaining := GREATEST(0, v_target - v_progress);
    v_reward := COALESCE(
      v_rule.reward_kwd,
      public.compute_incentive_amount(v_rule.id, v_target),
      0
    );

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'threshold', t.threshold_deliveries,
          'reward_kwd', t.reward_kwd,
          'reward_per_delivery_kwd', t.reward_per_delivery_kwd,
          'reward_mode', t.reward_mode
        )
        ORDER BY t.threshold_deliveries
      ),
      '[]'::jsonb
    )
    INTO v_tiers
    FROM public.incentive_rule_tiers t
    WHERE t.incentive_rule_id = v_rule.id;

    v_incentive := jsonb_build_object(
      'rule_id', v_rule.id,
      'name', v_rule.name,
      'eligible_count', v_eligible,
      'progress_count', v_progress,
      'target', v_target,
      'reward_kwd', v_reward,
      'remaining_deliveries', v_remaining,
      'target_mode', v_rule.target_mode,
      'tiers', v_tiers
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', dr.id,
        'name', dr.name,
        'scope_type', dr.scope_type,
        'restaurant_name', r.name,
        'start_date', dr.start_date,
        'end_date', dr.end_date,
        'summary', CASE
          WHEN dr.scope_type = 'restaurant' AND r.name IS NOT NULL THEN
            'Verified deliveries from ' || r.name || ' count toward incentives'
          WHEN dr.scope_type = 'partner' THEN
            'Verified deliveries for this partner count toward incentives'
          WHEN dr.scope_type = 'zone' THEN
            'Verified deliveries in your zone count toward incentives'
          ELSE dr.name
        END
      )
      ORDER BY dr.priority DESC, dr.name
    ),
    '[]'::jsonb
  )
  INTO v_rules
  FROM public.delivery_rules dr
  LEFT JOIN public.delivery_rule_scopes s ON s.delivery_rule_id = dr.id
  LEFT JOIN public.restaurants r ON r.id = s.restaurant_id
  WHERE dr.status = 'active'
    AND v_today BETWEEN dr.start_date AND dr.end_date
    AND EXISTS (
      SELECT 1
      FROM public.delivery_rule_scopes s2
      JOIN public.drivers drv ON drv.id = v_driver_id
      WHERE s2.delivery_rule_id = dr.id
        AND (
          (dr.scope_type = 'zone' AND s2.zone_id = drv.zone_id)
          OR (dr.scope_type = 'partner' AND s2.partner_id = drv.partner_id)
          OR (
            dr.scope_type = 'restaurant'
            AND s2.restaurant_id IN (
              SELECT dr3.restaurant_id
              FROM public.driver_restaurants dr3
              WHERE dr3.driver_id = v_driver_id
            )
          )
        )
    );

  v_shift_adherence := public._driver_shift_adherence(v_driver_id, v_today);
  v_performance := public.driver_delivery_performance_counts(v_driver_id);
  v_banner := public._driver_home_banner_for(v_driver_id);

  RETURN jsonb_build_object(
    'driver', v_driver,
    'session', v_session,
    'week', v_week,
    'primary_weekly_incentive', v_incentive,
    'delivery_rules', v_rules,
    'shift_adherence', v_shift_adherence,
    'performance', v_performance,
    'banner', v_banner,
    'force_app_update', v_force_app_update,
    'force_app_update_min_code', v_force_min
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('driver_devices.view', 'View driver devices inventory', 'drivers'),
  ('driver_devices.export', 'Export driver devices inventory', 'drivers')
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label, category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'driver_devices.view'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'drivers.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, 'driver_devices.export'
FROM public.admin_role_permissions rp
WHERE rp.permission_slug = 'drivers.view'
ON CONFLICT DO NOTHING;
