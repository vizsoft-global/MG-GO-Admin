-- Drivers SOP: database-level filtering for /drivers.
--
-- admin_drivers_list_base reproduces the row derivations fetchDriversForAdmin
-- does in TypeScript (account status from drivers, MG ID / zone preferring the
-- linked driver, restaurants preferring driver links, Kuwait-day deliveries,
-- multi-device) plus the SOP company derivation, so filters, search, sort and
-- counts all read one definition.
--
-- Filters (p_filters jsonb, every key ANDed):
--   text column   {"contains": "abc"}
--   list column   {"in": ["v1","v2"]}   '' = blank / Unassigned
--   range column  {"min": 1, "max": 5}
--   custom field  key "cf:<field_key>", contains or in
--
-- SECURITY INVOKER: staff RLS already governs every table read here.
-- Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.admin_drivers_list_base(p_archived boolean)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  driver_code text,
  mg_id text,
  full_name text,
  phone text,
  phone_digits text,
  partner_id uuid,
  partner_name text,
  partner_logo_key text,
  zone_id uuid,
  zone_name text,
  restaurant_ids uuid[],
  restaurant_names text[],
  workflow_status text,
  linked boolean,
  linked_profile_id uuid,
  account_status text,
  status_key text,
  is_blocked boolean,
  is_on_duty boolean,
  attendance_key text,
  today_deliveries integer,
  app_passcode text,
  archived_at timestamptz,
  avatar_url text,
  avatar_object_key text,
  rider_category text,
  source_company text,
  company_key text,
  company_name text,
  company_client_code text,
  company_tone text,
  client_id text,
  client_name text,
  custom_fields jsonb,
  multi_device boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH day AS (
    SELECT
      ((now() AT TIME ZONE 'Asia/Kuwait')::date)::timestamp AT TIME ZONE 'Asia/Kuwait' AS start_at
  ),
  intakes AS (
    SELECT i.*
    FROM public.driver_intakes i
    WHERE (p_archived AND i.archived_at IS NOT NULL)
       OR (NOT p_archived AND i.archived_at IS NULL)
  ),
  intake_rest AS (
    SELECT dir.intake_id,
           array_agg(r.id ORDER BY r.name, r.id) AS ids,
           array_agg(r.name ORDER BY r.name, r.id) AS names
    FROM public.driver_intake_restaurants dir
    JOIN public.restaurants r ON r.id = dir.restaurant_id
    WHERE dir.intake_id IN (SELECT id FROM intakes)
    GROUP BY dir.intake_id
  ),
  driver_rest AS (
    SELECT dr.driver_id,
           array_agg(r.id ORDER BY r.name, r.id) AS ids,
           array_agg(r.name ORDER BY r.name, r.id) AS names
    FROM public.driver_restaurants dr
    JOIN public.restaurants r ON r.id = dr.restaurant_id
    WHERE dr.driver_id IN (SELECT linked_profile_id FROM intakes WHERE linked_profile_id IS NOT NULL)
    GROUP BY dr.driver_id
  ),
  today AS (
    SELECT dl.driver_id, count(*)::integer AS n
    FROM public.deliveries dl, day
    WHERE dl.driver_id IN (SELECT linked_profile_id FROM intakes WHERE linked_profile_id IS NOT NULL)
      AND dl.delivered_at >= day.start_at
      AND dl.delivered_at < day.start_at + interval '1 day'
    GROUP BY dl.driver_id
  ),
  multi AS (
    SELECT m.driver_id FROM public.admin_drivers_multi_device_recent(7) m
  )
  SELECT
    i.id,
    i.created_at,
    i.driver_code,
    CASE WHEN i.linked_profile_id IS NOT NULL THEN coalesce(d.employee_id, i.employee_id) ELSE i.employee_id END,
    i.full_name,
    i.phone,
    nullif(regexp_replace(coalesce(i.phone, ''), '\D', '', 'g'), ''),
    i.partner_id,
    p.name,
    p.logo_url,
    coalesce(d.zone_id, i.zone_id),
    z.name,
    coalesce(CASE WHEN i.linked_profile_id IS NOT NULL THEN dr.ids END, ir.ids, ARRAY[]::uuid[]),
    coalesce(CASE WHEN i.linked_profile_id IS NOT NULL THEN dr.names END, ir.names, ARRAY[]::text[]),
    i.workflow_status::text,
    i.linked,
    i.linked_profile_id,
    coalesce(d.status::text, 'pending'),
    CASE WHEN coalesce(d.is_blocked, false) THEN 'blocked' ELSE coalesce(d.status::text, 'pending') END,
    coalesce(d.is_blocked, false),
    coalesce(d.is_on_duty, false),
    CASE WHEN coalesce(d.is_on_duty, false) THEN 'on_duty' ELSE 'off_duty' END,
    CASE WHEN i.linked_profile_id IS NOT NULL THEN coalesce(t.n, 0) ELSE 0 END,
    CASE WHEN i.archived_at IS NOT NULL THEN NULL ELSE d.app_passcode END,
    i.archived_at,
    i.avatar_url,
    d.avatar_object_key,
    coalesce(i.rider_category::text, 'in_house'),
    i.source_company,
    sc.key,
    sc.name,
    sc.client_code,
    CASE
      WHEN sc.key IS NULL THEN 'unassigned'
      WHEN sc.is_system THEN 'mg'
      ELSE 'partner'
    END,
    i.client_id,
    i.client_name,
    coalesce(i.custom_fields, '{}'::jsonb),
    (i.linked_profile_id IS NOT NULL AND i.linked_profile_id IN (SELECT driver_id FROM multi))
  FROM intakes i
  LEFT JOIN public.drivers d ON d.id = i.linked_profile_id
  LEFT JOIN public.partners p ON p.id = i.partner_id
  LEFT JOIN public.zones z ON z.id = coalesce(d.zone_id, i.zone_id)
  LEFT JOIN intake_rest ir ON ir.intake_id = i.id
  LEFT JOIN driver_rest dr ON dr.driver_id = i.linked_profile_id
  LEFT JOIN today t ON t.driver_id = i.linked_profile_id
  LEFT JOIN public.source_companies sc
    ON sc.key = CASE
      WHEN coalesce(i.rider_category::text, 'in_house') = 'in_house' THEN 'mg'
      ELSE i.source_company
    END;
$$;

-- Value a filter / sort reads for one column. Arrays come back as jsonb arrays.
CREATE OR REPLACE FUNCTION public.admin_drivers_column_value(p_row jsonb, p_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_key
    WHEN 'driverId' THEN p_row->'driver_code'
    WHEN 'mgId' THEN p_row->'mg_id'
    WHEN 'riderCategory' THEN p_row->'rider_category'
    WHEN 'companyClientId' THEN p_row->'company_client_code'
    WHEN 'companyName' THEN to_jsonb(coalesce(p_row->>'company_key', ''))
    WHEN 'name' THEN p_row->'full_name'
    WHEN 'phone' THEN p_row->'phone_digits'
    WHEN 'restaurants' THEN p_row->'restaurant_ids'
    WHEN 'zone' THEN to_jsonb(coalesce(p_row->>'zone_id', ''))
    WHEN 'platformId' THEN p_row->'client_id'
    WHEN 'platformName' THEN to_jsonb(coalesce(p_row->>'client_name', ''))
    WHEN 'todayDeliveries' THEN p_row->'today_deliveries'
    WHEN 'status' THEN p_row->'status_key'
    WHEN 'attendance' THEN p_row->'attendance_key'
    ELSE CASE
      WHEN p_key LIKE 'cf:%' THEN p_row->'custom_fields'->substr(p_key, 4)
      ELSE NULL
    END
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_drivers_filter_kind(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_key IN ('driverId', 'mgId', 'companyClientId', 'name', 'phone', 'platformId') THEN 'text'
    WHEN p_key IN ('riderCategory', 'companyName', 'zone', 'restaurants', 'status', 'attendance', 'platformName') THEN 'list'
    WHEN p_key = 'todayDeliveries' THEN 'range'
    WHEN p_key ~ '^cf:[A-Za-z0-9_]{1,64}$' THEN 'custom'
    ELSE NULL
  END;
$$;

-- Raises invalid_filter for an unknown column or a value of the wrong shape.
CREATE OR REPLACE FUNCTION public.admin_drivers_validate_filters(p_filters jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  f jsonb;
  v_kind text;
BEGIN
  IF p_filters IS NULL OR p_filters = 'null'::jsonb THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_filters) <> 'object' THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
  END IF;
  FOR k, f IN SELECT * FROM jsonb_each(p_filters) LOOP
    v_kind := public.admin_drivers_filter_kind(k);
    IF v_kind IS NULL OR jsonb_typeof(f) <> 'object' THEN
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
    END IF;
    IF f ? 'contains' THEN
      IF v_kind NOT IN ('text', 'custom') OR jsonb_typeof(f->'contains') <> 'string' THEN
        RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
      END IF;
    ELSIF f ? 'in' THEN
      IF v_kind NOT IN ('list', 'custom') OR jsonb_typeof(f->'in') <> 'array'
         OR jsonb_array_length(f->'in') > 500 THEN
        RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
      END IF;
    ELSIF f ? 'min' OR f ? 'max' THEN
      IF v_kind <> 'range'
         OR (f ? 'min' AND jsonb_typeof(f->'min') NOT IN ('number', 'null'))
         OR (f ? 'max' AND jsonb_typeof(f->'max') NOT IN ('number', 'null')) THEN
        RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;

-- True when the row passes every filter except p_skip (facets skip their own).
CREATE OR REPLACE FUNCTION public.admin_drivers_row_matches(
  p_row jsonb,
  p_filters jsonb,
  p_skip text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  f jsonb;
  v jsonb;
  v_text text;
  v_needle text;
  v_num numeric;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN
    RETURN true;
  END IF;
  FOR k, f IN SELECT * FROM jsonb_each(p_filters) LOOP
    CONTINUE WHEN k = p_skip;
    v := public.admin_drivers_column_value(p_row, k);

    IF f ? 'contains' THEN
      v_needle := lower(btrim(f->>'contains'));
      IF k = 'phone' THEN
        v_needle := regexp_replace(v_needle, '\D', '', 'g');
      END IF;
      CONTINUE WHEN v_needle = '';
      v_text := CASE
        WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN ''
        WHEN jsonb_typeof(v) = 'array' THEN (SELECT string_agg(e, ' ') FROM jsonb_array_elements_text(v) e)
        ELSE v #>> '{}'
      END;
      IF strpos(lower(coalesce(v_text, '')), v_needle) = 0 THEN
        RETURN false;
      END IF;

    ELSIF f ? 'in' THEN
      CONTINUE WHEN jsonb_array_length(f->'in') = 0;
      IF v IS NOT NULL AND jsonb_typeof(v) = 'array' THEN
        IF jsonb_array_length(v) = 0 THEN
          IF NOT (f->'in') ? '' THEN RETURN false; END IF;
        ELSIF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v) e
          WHERE (f->'in') ? e
        ) THEN
          RETURN false;
        END IF;
      ELSE
        v_text := CASE
          WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN ''
          ELSE v #>> '{}'
        END;
        IF NOT (f->'in') ? coalesce(v_text, '') THEN
          RETURN false;
        END IF;
      END IF;

    ELSIF f ? 'min' OR f ? 'max' THEN
      IF v IS NULL OR jsonb_typeof(v) <> 'number' THEN
        RETURN false;
      END IF;
      v_num := (v #>> '{}')::numeric;
      IF jsonb_typeof(f->'min') = 'number' AND v_num < (f->>'min')::numeric THEN
        RETURN false;
      END IF;
      IF jsonb_typeof(f->'max') = 'number' AND v_num > (f->>'max')::numeric THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_drivers_search_matches(p_row jsonb, p_search text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    btrim(coalesce(p_search, '')) = ''
    OR strpos(
      lower(concat_ws(' ',
        p_row->>'full_name', p_row->>'driver_code', p_row->>'mg_id',
        p_row->>'partner_name', p_row->>'zone_name',
        p_row->>'client_id', p_row->>'client_name',
        p_row->>'company_name', p_row->>'company_client_code'
      )),
      lower(btrim(p_search))
    ) > 0
    OR (
      regexp_replace(p_search, '\D', '', 'g') <> ''
      AND strpos(coalesce(p_row->>'phone_digits', ''), regexp_replace(p_search, '\D', '', 'g')) > 0
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_drivers_tab_matches(p_row jsonb, p_tab text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(p_tab, 'all')
    WHEN 'pending' THEN (
      p_row->>'linked_profile_id' IS NULL
      OR p_row->>'workflow_status' = 'pending'
      OR p_row->>'account_status' = 'pending'
    )
    WHEN 'on_duty' THEN (p_row->>'is_on_duty')::boolean
    WHEN 'multi_device' THEN (p_row->>'multi_device')::boolean
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_drivers_page(
  p_tab text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort_key text DEFAULT 'name',
  p_sort_dir text DEFAULT 'asc',
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tab text := coalesce(p_tab, 'all');
  v_sort text := coalesce(p_sort_key, 'name');
  v_desc boolean := lower(coalesce(p_sort_dir, 'asc')) = 'desc';
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_tab NOT IN ('all', 'pending', 'on_duty', 'multi_device', 'archived') THEN
    RAISE EXCEPTION 'invalid_tab' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('driverId', 'mgId', 'riderCategory', 'companyClientId', 'companyName',
                    'name', 'phone', 'restaurants', 'zone', 'platformId', 'platformName',
                    'todayDeliveries', 'status', 'attendance')
     AND v_sort !~ '^cf:[A-Za-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_sort' USING ERRCODE = '22023';
  END IF;
  PERFORM public.admin_drivers_validate_filters(p_filters);

  WITH base AS MATERIALIZED (
    SELECT to_jsonb(b) AS r
    FROM public.admin_drivers_list_base(v_tab = 'archived') b
  ),
  tabbed AS (
    SELECT r FROM base WHERE public.admin_drivers_tab_matches(r, v_tab)
  ),
  filtered AS (
    SELECT r FROM tabbed
    WHERE public.admin_drivers_search_matches(r, p_search)
      AND public.admin_drivers_row_matches(r, p_filters)
  ),
  keyed AS (
    SELECT
      r,
      CASE WHEN v_sort = 'todayDeliveries' THEN (r->>'today_deliveries')::numeric END AS sort_num,
      CASE
        WHEN v_sort = 'todayDeliveries' THEN NULL
        WHEN v_sort = 'companyName' THEN lower(r->>'company_name')
        WHEN v_sort = 'zone' THEN lower(r->>'zone_name')
        WHEN v_sort = 'platformName' THEN lower(r->>'client_name')
        WHEN v_sort = 'restaurants' THEN lower(nullif(array_to_string(
          ARRAY(SELECT jsonb_array_elements_text(r->'restaurant_names')), ', '), ''))
        ELSE lower(nullif(
          (SELECT string_agg(e, ', ') FROM jsonb_array_elements_text(
            CASE jsonb_typeof(public.admin_drivers_column_value(r, v_sort))
              WHEN 'array' THEN public.admin_drivers_column_value(r, v_sort)
              WHEN 'null' THEN '[]'::jsonb
              ELSE jsonb_build_array(public.admin_drivers_column_value(r, v_sort) #>> '{}')
            END) e), ''))
      END AS sort_text
    FROM filtered
  ),
  page AS (
    SELECT r, row_number() OVER (
      ORDER BY
        CASE WHEN NOT v_desc THEN sort_num END ASC NULLS LAST,
        CASE WHEN v_desc THEN sort_num END DESC NULLS LAST,
        CASE WHEN NOT v_desc THEN sort_text END ASC NULLS LAST,
        CASE WHEN v_desc THEN sort_text END DESC NULLS LAST,
        (r->>'id')
    ) AS ord
    FROM keyed
  )
  SELECT jsonb_build_object(
    'rows', coalesce((
      SELECT jsonb_agg(r ORDER BY ord)
      FROM page
      WHERE ord > v_offset AND ord <= v_offset + v_limit
    ), '[]'::jsonb),
    'filtered_total', (SELECT count(*) FROM filtered),
    'tab_total', (SELECT count(*) FROM tabbed),
    'kpis', (
      SELECT jsonb_build_object(
        'total', count(*),
        'activeToday', count(*) FILTER (WHERE r->>'account_status' = 'active'),
        'onlineNow', count(*) FILTER (WHERE (r->>'is_on_duty')::boolean),
        'inactive', count(*) FILTER (WHERE r->>'account_status' = 'active' AND NOT (r->>'is_on_duty')::boolean),
        'pendingVerification', count(*) FILTER (WHERE
          r->>'linked_profile_id' IS NULL
          OR r->>'workflow_status' = 'pending'
          OR r->>'account_status' = 'pending'),
        'suspended', count(*) FILTER (WHERE r->>'account_status' = 'suspended')
      )
      FROM base
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Distinct values for one list column's filter popup, with every other filter
-- applied (Excel behaviour). Company Name also lists every active company so a
-- newly added one is pickable before any rider is linked to it.
CREATE OR REPLACE FUNCTION public.admin_drivers_filter_values(
  p_column text,
  p_tab text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tab text := coalesce(p_tab, 'all');
  v_kind text := public.admin_drivers_filter_kind(p_column);
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_tab NOT IN ('all', 'pending', 'on_duty', 'multi_device', 'archived') THEN
    RAISE EXCEPTION 'invalid_tab' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('list', 'custom') THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
  END IF;
  PERFORM public.admin_drivers_validate_filters(p_filters);

  WITH rows_in AS (
    SELECT to_jsonb(b) AS r
    FROM public.admin_drivers_list_base(v_tab = 'archived') b
  ),
  scoped AS (
    SELECT r FROM rows_in
    WHERE public.admin_drivers_tab_matches(r, v_tab)
      AND public.admin_drivers_search_matches(r, p_search)
      AND public.admin_drivers_row_matches(r, p_filters, p_column)
  ),
  vals AS (
    SELECT DISTINCT
      CASE p_column
        WHEN 'restaurants' THEN x.value_id
        ELSE coalesce(x.value_id, '')
      END AS value,
      x.label
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT * FROM (
        SELECT rid.v AS value_id, rn.v AS label
        FROM jsonb_array_elements_text(s.r->'restaurant_ids') WITH ORDINALITY rid(v, n)
        JOIN jsonb_array_elements_text(s.r->'restaurant_names') WITH ORDINALITY rn(v, n)
          ON rn.n = rid.n
        WHERE p_column = 'restaurants'
        UNION ALL
        SELECT coalesce(s.r->>'company_key', ''), s.r->>'company_name'
        WHERE p_column = 'companyName'
        UNION ALL
        SELECT coalesce(s.r->>'zone_id', ''), s.r->>'zone_name'
        WHERE p_column = 'zone'
        UNION ALL
        SELECT coalesce(s.r->>'client_name', ''), s.r->>'client_name'
        WHERE p_column = 'platformName'
        UNION ALL
        SELECT s.r->>'rider_category', NULL WHERE p_column = 'riderCategory'
        UNION ALL
        SELECT s.r->>'status_key', NULL WHERE p_column = 'status'
        UNION ALL
        SELECT s.r->>'attendance_key', NULL WHERE p_column = 'attendance'
        UNION ALL
        SELECT e, e
        FROM jsonb_array_elements_text(
          CASE jsonb_typeof(s.r->'custom_fields'->substr(p_column, 4))
            WHEN 'array' THEN s.r->'custom_fields'->substr(p_column, 4)
            WHEN 'null' THEN '[""]'::jsonb
            ELSE jsonb_build_array(s.r->'custom_fields'->>substr(p_column, 4))
          END) e
        WHERE p_column LIKE 'cf:%'
      ) u
    ) x
    UNION
    SELECT c.key, c.name
    FROM public.source_companies c
    WHERE p_column = 'companyName' AND c.is_active
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('value', value, 'label', label)
    ORDER BY (value = ''), lower(coalesce(label, value))
  ), '[]'::jsonb)
  INTO v_result
  FROM vals
  WHERE value IS NOT NULL;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_drivers_list_base(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_drivers_page(text, text, jsonb, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_drivers_filter_values(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_drivers_list_base(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_drivers_page(text, text, jsonb, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drivers_filter_values(text, text, text, jsonb) TO authenticated;
