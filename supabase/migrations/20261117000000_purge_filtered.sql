-- Clear by filter (column-based selective purge).
--
-- "Clear all" empties a module; this adds the narrower option beside it: pick
-- values from one or more columns, review the matching rows, then hard-delete
-- only those. Super-admin only — `admin_purge_filtered_*` is gated by
-- `_admin_purge_require_super_admin()`, deliberately stricter than Clear all,
-- whose `*.bulk_delete` tick a Manager can hold.
--
-- Two facts drive the shape of this file:
--
--  1. The server owns the filter spec. `admin_purge_filter_columns` is the one
--     place that says which columns an entity offers and of what kind, so the
--     dialog can never draw a column the matcher cannot resolve. Labels stay
--     client-side (i18n), values come back from `admin_purge_filter_values`.
--     The only per-entity code is a row source: `cte` names the table, `key`
--     the column each filter reads, and the label/sublabel/status expressions
--     that make the review list readable.
--
--  2. The delete path is the existing one. `admin_purge_filtered_run` resolves
--     matched ids and hands them to the same per-id purgers Clear all uses
--     (`admin_purge_drivers`, `admin_purge_deliveries`, …) or to the same
--     inline child-first deletes, so storage sweeps, the Auth-user manifest and
--     the FK release order cannot drift between the two entry points.
--
-- Drivers gains one filter column on the way: `vehicleType`, read from the
-- rider's own `vehicle_type_key` and falling back to the assigned vehicle's, so
-- a rider whose type was never set at Add Driver is still reachable by the
-- vehicle they actually ride.

/* ------------------------------------------------------------------ */
/* 1. Drivers: Vehicle Type joins the filter set                       */
/* ------------------------------------------------------------------ */

-- Two columns are appended to the tail of the RETURNS TABLE, so the change has
-- to DROP and recreate (`CREATE OR REPLACE` cannot widen an OUT parameter list).
-- Nothing selects `*` off this function — `admin_list_drivers_page`,
-- `admin_drivers_filter_values` and the purge matcher all read `to_jsonb(b)` —
-- so appending is safe for every existing caller.
DROP FUNCTION IF EXISTS public.admin_drivers_list_base(boolean);

CREATE OR REPLACE FUNCTION public.admin_drivers_list_base(p_archived boolean)
RETURNS TABLE(
  id uuid, created_at timestamp with time zone, driver_code text, mg_id text,
  full_name text, phone text, phone_digits text, partner_id uuid,
  partner_name text, partner_logo_key text, zone_id uuid, zone_name text,
  restaurant_ids uuid[], restaurant_names text[], workflow_status text,
  linked boolean, linked_profile_id uuid, account_status text, status_key text,
  is_blocked boolean, is_on_duty boolean, attendance_key text,
  today_deliveries integer, app_passcode text, archived_at timestamp with time zone,
  avatar_url text, avatar_object_key text, rider_category text,
  source_company text, company_key text, company_name text,
  company_client_code text, company_tone text, client_id text, client_name text,
  custom_fields jsonb, multi_device boolean,
  vehicle_type_key text, vehicle_type_name text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
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
    (i.linked_profile_id IS NOT NULL AND i.linked_profile_id IN (SELECT driver_id FROM multi)),
    coalesce(d.vehicle_type_key, v.vehicle_type_key, i.vehicle_type_key),
    coalesce(vt.label_en, d.vehicle_type_key, v.vehicle_type_key, i.vehicle_type_key)
  FROM intakes i
  LEFT JOIN public.drivers d ON d.id = i.linked_profile_id
  LEFT JOIN public.partners p ON p.id = i.partner_id
  LEFT JOIN public.zones z ON z.id = coalesce(d.zone_id, i.zone_id)
  LEFT JOIN intake_rest ir ON ir.intake_id = i.id
  LEFT JOIN driver_rest dr ON dr.driver_id = i.linked_profile_id
  LEFT JOIN today t ON t.driver_id = i.linked_profile_id
  LEFT JOIN public.vehicles v ON v.id = coalesce(d.vehicle_id, i.vehicle_id)
  LEFT JOIN public.vehicle_types vt ON vt.key = coalesce(d.vehicle_type_key, v.vehicle_type_key, i.vehicle_type_key)
  LEFT JOIN public.source_companies sc
    ON sc.key = CASE
      WHEN coalesce(i.rider_category::text, 'in_house') = 'in_house' THEN 'mg'
      ELSE i.source_company
    END;
$function$;

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
    WHEN 'vehicleType' THEN to_jsonb(coalesce(p_row->>'vehicle_type_key', ''))
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
    WHEN p_key IN ('riderCategory', 'companyName', 'zone', 'restaurants', 'status',
                   'attendance', 'platformName', 'vehicleType') THEN 'list'
    WHEN p_key = 'todayDeliveries' THEN 'range'
    WHEN p_key ~ '^cf:[A-Za-z0-9_]{1,64}$' THEN 'custom'
    ELSE NULL
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
                    'todayDeliveries', 'status', 'attendance', 'vehicleType')
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
        WHEN v_sort = 'vehicleType' THEN lower(r->>'vehicle_type_name')
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
        SELECT coalesce(s.r->>'vehicle_type_key', ''),
               coalesce(s.r->>'vehicle_type_name', s.r->>'vehicle_type_key')
        WHERE p_column = 'vehicleType'
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

/* ------------------------------------------------------------------ */
/* 2. Shared filter primitives                                         */
/*                                                                    */
/* The same three shapes Clear-all's Excel-style column filters use:   */
/* `{contains}` over flattened text, `{in:[…]}` over a scalar or an    */
/* array, and `{min,max}` over a number. Kept in one place so every    */
/* entity's matcher reads a value exactly the way the drivers engine   */
/* already does.                                                       */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.admin_purge_value_text(p_v jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_v IS NULL OR jsonb_typeof(p_v) = 'null' THEN ''
    WHEN jsonb_typeof(p_v) = 'array' THEN (
      SELECT coalesce(string_agg(e, ' '), '') FROM jsonb_array_elements_text(p_v) e
    )
    ELSE p_v #>> '{}'
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_value_in(p_v jsonb, p_in jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_v) = 'array' THEN (
      CASE
        WHEN jsonb_array_length(p_v) = 0 THEN (p_in ? '')
        ELSE EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_v) e WHERE p_in ? e)
      END
    )
    ELSE (p_in ? public.admin_purge_value_text(p_v))
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_value_in_range(p_v jsonb, p_f jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_v IS NULL OR jsonb_typeof(p_v) <> 'number' THEN false
    WHEN jsonb_typeof(p_f->'min') = 'number'
         AND (p_v #>> '{}')::numeric < (p_f->>'min')::numeric THEN false
    WHEN jsonb_typeof(p_f->'max') = 'number'
         AND (p_v #>> '{}')::numeric > (p_f->>'max')::numeric THEN false
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_col_matches(p_kind text, p_v jsonb, p_f jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'range' THEN public.admin_purge_value_in_range(p_v, p_f)
    WHEN p_f ? 'contains' THEN
      public.admin_purge_value_text(p_v) <> ''
      AND strpos(
        lower(public.admin_purge_value_text(p_v)),
        lower(btrim(coalesce(p_f->>'contains', '')))
      ) > 0
    WHEN p_f ? 'in' THEN
      jsonb_typeof(p_f->'in') = 'array' AND public.admin_purge_value_in(p_v, p_f->'in')
    ELSE true
  END;
$$;

/* ------------------------------------------------------------------ */
/* 3. The column catalogue — the server's word on what is filterable   */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.admin_purge_filter_columns(p_entity text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_entity
    WHEN 'drivers' THEN jsonb_build_array(
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'riderCategory', 'kind', 'list'),
      jsonb_build_object('key', 'companyName', 'kind', 'list'),
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'attendance', 'kind', 'list'),
      jsonb_build_object('key', 'restaurants', 'kind', 'list'),
      jsonb_build_object('key', 'platformName', 'kind', 'list'),
      jsonb_build_object('key', 'vehicleType', 'kind', 'list'),
      jsonb_build_object('key', 'todayDeliveries', 'kind', 'range')
    )
    WHEN 'vehicles' THEN jsonb_build_array(
      jsonb_build_object('key', 'kind', 'kind', 'list'),
      jsonb_build_object('key', 'condition', 'kind', 'list'),
      jsonb_build_object('key', 'carType', 'kind', 'list'),
      jsonb_build_object('key', 'typeOfUse', 'kind', 'list'),
      jsonb_build_object('key', 'fuelType', 'kind', 'list'),
      jsonb_build_object('key', 'fuelCompany', 'kind', 'list'),
      jsonb_build_object('key', 'carsCompany', 'kind', 'list'),
      jsonb_build_object('key', 'empCompany', 'kind', 'list'),
      jsonb_build_object('key', 'project', 'kind', 'list'),
      jsonb_build_object('key', 'replacement', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'year', 'kind', 'range')
    )
    WHEN 'deliveries' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'restaurant', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'attendance' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'earnings' THEN jsonb_build_array(
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'payouts' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'requests' THEN jsonb_build_array(
      jsonb_build_object('key', 'type', 'kind', 'list'),
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'visits' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'department', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'notifications' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'priority', 'kind', 'list'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'esign' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'fuel' THEN jsonb_build_array(
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'station', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'wrong_actions' THEN jsonb_build_array(
      jsonb_build_object('key', 'actionType', 'kind', 'list'),
      jsonb_build_object('key', 'severity', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'documents' THEN jsonb_build_array(
      jsonb_build_object('key', 'docType', 'kind', 'list'),
      jsonb_build_object('key', 'tracking', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'order_recon' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'file', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'verifications' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'restaurant', 'kind', 'list'),
      jsonb_build_object('key', 'driver', 'kind', 'text'),
      jsonb_build_object('key', 'date', 'kind', 'range')
    )
    WHEN 'restaurants' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'partner', 'kind', 'list'),
      jsonb_build_object('key', 'zone', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'zones' THEN jsonb_build_array(
      jsonb_build_object('key', 'zoneType', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'partners' THEN jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'companies' THEN jsonb_build_array(
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'driver_groups' THEN jsonb_build_array(
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'assets' THEN jsonb_build_array(
      jsonb_build_object('key', 'category', 'kind', 'list'),
      jsonb_build_object('key', 'active', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'delivery_rules' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'scopeType', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    WHEN 'incentive_rules' THEN jsonb_build_array(
      jsonb_build_object('key', 'status', 'kind', 'list'),
      jsonb_build_object('key', 'scopeType', 'kind', 'list'),
      jsonb_build_object('key', 'period', 'kind', 'list'),
      jsonb_build_object('key', 'name', 'kind', 'text')
    )
    ELSE NULL
  END;
$$;

-- Kind for one column of one entity, `NULL` when the entity does not offer it.
-- The validator and the matcher both read this, so a column the catalogue
-- stopped advertising can never still be matched.
CREATE OR REPLACE FUNCTION public.admin_purge_filter_kind_of(p_entity text, p_key text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT e->>'kind'
  FROM jsonb_array_elements(coalesce(public.admin_purge_filter_columns(p_entity), '[]'::jsonb)) e
  WHERE e->>'key' = p_key
  LIMIT 1;
$$;

-- Rejects an unknown column or a value of the wrong shape before any scan runs.
CREATE OR REPLACE FUNCTION public.admin_purge_validate_filters(p_entity text, p_filters jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
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
  IF public.admin_purge_filter_columns(p_entity) IS NULL THEN
    RAISE EXCEPTION 'unknown_entity' USING ERRCODE = '22023';
  END IF;
  FOR k, f IN SELECT * FROM jsonb_each(p_filters) LOOP
    v_kind := public.admin_purge_filter_kind_of(p_entity, k);
    IF v_kind IS NULL OR jsonb_typeof(f) <> 'object' THEN
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
    END IF;
    IF f ? 'contains' THEN
      IF v_kind <> 'text' OR jsonb_typeof(f->'contains') <> 'string' THEN
        RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
      END IF;
    ELSIF f ? 'in' THEN
      IF v_kind <> 'list' OR jsonb_typeof(f->'in') <> 'array'
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

/* ------------------------------------------------------------------ */
/* 4. Vehicles as filter rows                                          */
/*                                                                    */
/* The vehicles list is assembled in TypeScript — there is no server   */
/* list RPC to reuse — so the purge needs its own row source. Every    */
/* filter reads a column of this jsonb, and the assigned rider comes   */
/* from `drivers.vehicle_id`, the same link the list uses.             */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.admin_purge_vehicle_filter_rows()
RETURNS TABLE(vehicle_id uuid, r jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assigned AS (
    SELECT d.vehicle_id,
           d.id AS driver_id,
           d.driver_code,
           d.project_key,
           d.partner_id,
           p.full_name
    FROM public.drivers d
    LEFT JOIN public.profiles p ON p.id = d.id
    WHERE d.vehicle_id IS NOT NULL
  )
  SELECT v.id,
         jsonb_build_object(
           'id', v.id,
           'label', v.reg_number,
           'sublabel', concat_ws(
             ' · ',
             nullif(coalesce(v.vehicle_type_key, ''), ''),
             nullif(coalesce(dr.full_name, dr.driver_code, ''), '')
           ),
           'status', v.status::text,
           'plate', v.reg_number,
           'chassis', v.chassis_no,
           'kind', coalesce(v.vehicle_type_key, ''),
           'kindLabel', vt.label_en,
           'condition', coalesce(v.condition, ''),
           'carType', coalesce(v.car_type, ''),
           'typeOfUse', coalesce(v.type_of_use, ''),
           'fuelType', coalesce(v.fuel_type, ''),
           'fuelCompany', coalesce(v.fuel_company, ''),
           'carsCompany', coalesce(owner.id::text, ''),
           'carsCompanyLabel', owner.name,
           'empCompany', coalesce(dr.partner_id::text, ''),
           'empCompanyLabel', emp.name,
           'project', coalesce(dr.project_key, ''),
           'projectLabel', dr.project_key,
           'driver', concat_ws(' · ', dr.full_name, dr.driver_code),
           'driverId', dr.driver_id,
           'replacement', CASE WHEN v.replaces_vehicle_id IS NULL THEN 'no' ELSE 'yes' END,
           'year', to_jsonb(v.model_year)
         ) AS r
  FROM public.vehicles v
  LEFT JOIN public.vehicle_types vt ON vt.key = v.vehicle_type_key
  LEFT JOIN public.partners owner ON owner.id = v.owner_partner_id
  LEFT JOIN LATERAL (
    SELECT * FROM assigned a WHERE a.vehicle_id = v.id ORDER BY a.driver_code LIMIT 1
  ) dr ON true
  LEFT JOIN public.partners emp ON emp.id = dr.partner_id;
$$;

-- One value reader per entity, in the shape the matcher compares against:
-- arrays stay arrays (a rider's restaurants), numbers stay numbers (a range),
-- everything else flattens to text. `p_key` is validated against the catalogue
-- before this is reached, so an unknown key can only come from a
-- catalogue/matcher mismatch.
CREATE OR REPLACE FUNCTION public.admin_purge_row_value(p_entity text, p_r jsonb, p_key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entity = 'drivers' THEN public.admin_drivers_column_value(p_r, p_key)
    WHEN p_r->p_key IS NULL OR jsonb_typeof(p_r->p_key) = 'null' THEN '""'::jsonb
    WHEN jsonb_typeof(p_r->p_key) IN ('array', 'number') THEN p_r->p_key
    ELSE to_jsonb(public.admin_purge_value_text(p_r->p_key))
  END;
$$;

-- True when a row passes every filter. Drivers delegate to the list page's own
-- matcher, so a filtered purge and a filtered list can never disagree about
-- which rows matched.
CREATE OR REPLACE FUNCTION public.admin_purge_row_matches(
  p_entity text,
  p_r jsonb,
  p_filters jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  k text;
  f jsonb;
BEGIN
  IF p_filters IS NULL
     OR p_filters = 'null'::jsonb
     OR jsonb_typeof(p_filters) <> 'object' THEN
    RETURN true;
  END IF;
  IF p_entity = 'drivers' THEN
    RETURN public.admin_drivers_row_matches(p_r, p_filters);
  END IF;
  FOR k, f IN SELECT * FROM jsonb_each(p_filters) LOOP
    IF NOT public.admin_purge_col_matches(
             public.admin_purge_filter_kind_of(p_entity, k),
             public.admin_purge_row_value(p_entity, p_r, k),
             f) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

/* ------------------------------------------------------------------ */
/* 5. The row source — one branch per entity                           */
/*                                                                    */
/* Every row carries the filter keys the catalogue advertises plus the  */
/* three display fields the review list and the typed confirm need:     */
/* `label` (what the operator recognises), `sublabel` (adjacent facts)  */
/* and `status`. Date ranges are `YYYYMMDD` integers, which sorts and   */
/* compares as a number and survives JSON without a timezone.           */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.admin_purge_rows_of(p_entity text)
RETURNS TABLE(purge_id text, row_json jsonb, purge_kind text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_entity = 'drivers' THEN
    RETURN QUERY
    WITH base AS (
      SELECT to_jsonb(b) AS b FROM public.admin_drivers_list_base(false) b
      UNION ALL
      SELECT to_jsonb(b) AS b FROM public.admin_drivers_list_base(true) b
    )
    SELECT
      coalesce(b->>'linked_profile_id', b->>'id'),
      b || jsonb_build_object(
             'label', coalesce(b->>'full_name', ''),
             'sublabel', concat_ws(' · ',
               nullif(b->>'driver_code', ''),
               nullif(b->>'zone_name', ''),
               nullif(b->>'company_name', '')),
             'status', coalesce(b->>'status_key', '')
           ),
      CASE WHEN b->>'linked_profile_id' IS NULL THEN 'intake' ELSE 'driver' END
    FROM base;
    RETURN;
  END IF;

  IF p_entity = 'vehicles' THEN
    RETURN QUERY
    SELECT f.vehicle_id::text, f.r, 'vehicles'
    FROM public.admin_purge_vehicle_filter_rows() f;
    RETURN;
  END IF;

  IF p_entity = 'deliveries' THEN
    RETURN QUERY
    SELECT d.id::text,
           jsonb_build_object(
             'id', d.id,
             'label', coalesce(nullif(d.external_order_id, ''), left(d.id::text, 8)),
             'sublabel', concat_ws(' · ', nullif(pr.full_name, ''), nullif(rs.name, '')),
             'status', d.status::text,
             'zone', coalesce(d.zone_id::text, ''),
             'partner', coalesce(d.partner_id::text, ''),
             'restaurant', coalesce(d.restaurant_id::text, ''),
             'date', to_jsonb(to_char(d.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'deliveries'
    FROM public.deliveries d
    LEFT JOIN public.profiles pr ON pr.id = d.driver_id
    LEFT JOIN public.restaurants rs ON rs.id = d.restaurant_id;
    RETURN;
  END IF;

  IF p_entity = 'attendance' THEN
    RETURN QUERY
    SELECT al.id::text,
           jsonb_build_object(
             'id', al.id,
             'label', coalesce(nullif(pr.full_name, ''), d.driver_code, ''),
             'sublabel', concat_ws(' · ', d.driver_code, al.log_date::text),
             'status', al.status::text,
             'date', to_jsonb(to_char(al.log_date, 'YYYYMMDD')::integer)
           ),
           'attendance_logs'
    FROM public.attendance_logs al
    LEFT JOIN public.profiles pr ON pr.id = al.driver_id
    LEFT JOIN public.drivers d ON d.id = al.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'earnings' THEN
    -- Both halves of the earnings module are listed, because Clear all deletes
    -- both: a filtered purge that removed only the daily rows would leave the
    -- wallet ledger behind with nothing it points at.
    RETURN QUERY
    SELECT e.id::text,
           jsonb_build_object(
             'id', e.id,
             'label', coalesce(nullif(e.full_name, ''), e.driver_code, ''),
             'sublabel', concat_ws(' · ', e.earn_date::text, e.entry),
             'status', e.entry,
             'driver', concat_ws(' · ', nullif(e.full_name, ''), nullif(e.driver_code, '')),
             'date', to_jsonb(to_char(e.earn_date, 'YYYYMMDD')::integer)
           ),
           e.kind
    FROM (
      SELECT de.id, de.earn_date, pr.full_name, d.driver_code,
             'daily'::text AS entry, 'earnings_daily'::text AS kind
      FROM public.driver_earnings_daily de
      LEFT JOIN public.profiles pr ON pr.id = de.driver_id
      LEFT JOIN public.drivers d ON d.id = de.driver_id
      UNION ALL
      SELECT we.id, we.earn_date, pr.full_name, d.driver_code,
             coalesce(we.entry_type::text, 'wallet'), 'wallet'::text
      FROM public.driver_wallet_entries we
      LEFT JOIN public.profiles pr ON pr.id = we.driver_id
      LEFT JOIN public.drivers d ON d.id = we.driver_id
    ) e;
    RETURN;
  END IF;

  IF p_entity = 'payouts' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.period_start::text || ' → ' || r.period_end::text,
             'sublabel', coalesce(r.status::text, ''),
             'status', r.status::text,
             'date', to_jsonb(to_char(r.period_start, 'YYYYMMDD')::integer)
           ),
           'payout_run'
    FROM public.payout_runs r;
    RETURN;
  END IF;

  IF p_entity = 'requests' THEN
    RETURN QUERY
    SELECT q.id::text,
           jsonb_build_object(
             'id', q.id,
             'label', q.request_code,
             'sublabel', concat_ws(' · ', q.request_type, nullif(q.full_name, '')),
             'status', q.status::text,
             'type', q.request_type,
             'driver', concat_ws(' · ', nullif(q.full_name, ''), nullif(q.driver_code, '')),
             'date', to_jsonb(to_char(q.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'requests'
    FROM (
      SELECT rq.id, rq.request_code, rq.request_type, rq.status, rq.created_at,
             pr.full_name, d.driver_code
      FROM public.requests rq
      LEFT JOIN public.profiles pr ON pr.id = rq.driver_id
      LEFT JOIN public.drivers d ON d.id = rq.driver_id
    ) q;
    RETURN;
  END IF;

  IF p_entity = 'visits' THEN
    RETURN QUERY
    SELECT v.id::text,
           jsonb_build_object(
             'id', v.id,
             'label', v.booking_code,
             'sublabel', concat_ws(' · ', v.department_key, v.scheduled_date::text),
             'status', v.status::text,
             'department', v.department_key,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(v.scheduled_date, 'YYYYMMDD')::integer)
           ),
           'visit_bookings'
    FROM public.visit_bookings v
    LEFT JOIN public.profiles pr ON pr.id = v.driver_id
    LEFT JOIN public.drivers d ON d.id = v.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'notifications' THEN
    RETURN QUERY
    SELECT c.id::text,
           jsonb_build_object(
             'id', c.id,
             'label', c.title,
             'sublabel', concat_ws(' · ', c.category::text, c.priority::text),
             'status', c.status::text,
             'category', c.category::text,
             'priority', c.priority::text,
             'date', to_jsonb(to_char(c.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'notification_campaigns'
    FROM public.notification_campaigns c;
    RETURN;
  END IF;

  IF p_entity = 'esign' THEN
    RETURN QUERY
    SELECT s.id::text,
           jsonb_build_object(
             'id', s.id,
             'label', s.request_code,
             'sublabel', concat_ws(' · ', nullif(s.title, ''), nullif(cat.label_en, ''), nullif(pr.full_name, '')),
             'status', s.status::text,
             'category', s.category_key,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(s.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'esign'
    FROM public.esign_requests s
    LEFT JOIN public.esign_categories cat ON cat.key = s.category_key
    LEFT JOIN public.profiles pr ON pr.id = s.driver_id
    LEFT JOIN public.drivers d ON d.id = s.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'fuel' THEN
    RETURN QUERY
    SELECT f.id::text,
           jsonb_build_object(
             'id', f.id,
             'label', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'sublabel', concat_ws(' · ', nullif(f.station_name, ''),
                                  to_char(f.filled_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD')),
             'status', 'fill',
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'station', coalesce(f.station_name, ''),
             'date', to_jsonb(to_char(f.filled_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'fuel_fill'
    FROM public.fuel_fills f
    LEFT JOIN public.profiles pr ON pr.id = f.driver_id
    LEFT JOIN public.drivers d ON d.id = f.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'wrong_actions' THEN
    RETURN QUERY
    SELECT w.id::text,
           jsonb_build_object(
             'id', w.id,
             'label', coalesce(nullif(pr.full_name, ''), d.driver_code, '—'),
             'sublabel', concat_ws(' · ', w.action_type, w.severity::text,
                                   left(coalesce(w.details, ''), 60)),
             'status', w.severity::text,
             'actionType', w.action_type,
             'severity', w.severity::text,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(w.occurred_at AT TIME ZONE 'Asia/Kuwait', 'YYYYMMDD')::integer)
           ),
           'wrong_actions'
    FROM public.wrong_actions w
    LEFT JOIN public.profiles pr ON pr.id = w.driver_id
    LEFT JOIN public.drivers d ON d.id = w.driver_id;
    RETURN;
  END IF;

  IF p_entity = 'documents' THEN
    RETURN QUERY
    SELECT t.id::text,
           jsonb_build_object(
             'id', t.id,
             'label', t.doc_type::text,
             'sublabel', concat_ws(' · ',
                            coalesce(nullif(pr.full_name, ''), nullif(i.full_name, ''), ''),
                            t.expires_at::text),
             'status', CASE WHEN t.track_expiry THEN 'tracked' ELSE 'untracked' END,
             'docType', t.doc_type::text,
             'tracking', CASE WHEN t.track_expiry THEN 'yes' ELSE 'no' END,
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(i.full_name, ''),
                                 nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(t.expires_at, 'YYYYMMDD')::integer)
           ),
           'document_tracking'
    FROM public.document_tracking t
    LEFT JOIN public.profiles pr ON pr.id = t.driver_id
    LEFT JOIN public.drivers d ON d.id = t.driver_id
    LEFT JOIN public.driver_intakes i ON i.id = t.intake_id;
    RETURN;
  END IF;

  IF p_entity = 'order_recon' THEN
    RETURN QUERY
    SELECT rn.id::text,
           jsonb_build_object(
             'id', rn.id,
             'label', rn.file_name,
             'sublabel', rn.from_date::text || ' → ' || rn.to_date::text,
             'status', rn.status::text,
             'file', rn.file_name,
             'date', to_jsonb(to_char(rn.from_date, 'YYYYMMDD')::integer)
           ),
           'order_recon_run'
    FROM public.order_recon_runs rn;
    RETURN;
  END IF;

  IF p_entity = 'verifications' THEN
    RETURN QUERY
    SELECT v.id::text,
           jsonb_build_object(
             'id', v.id,
             'label', v.service_date::text || ' · ' || coalesce(rs.name, '—'),
             'sublabel', concat_ws(' · ', nullif(pr.full_name, ''), nullif(pt.name, '')),
             'status', v.status::text,
             'partner', coalesce(v.partner_id::text, ''),
             'restaurant', coalesce(v.restaurant_id::text, ''),
             'driver', concat_ws(' · ', nullif(pr.full_name, ''), nullif(d.driver_code, '')),
             'date', to_jsonb(to_char(v.service_date, 'YYYYMMDD')::integer)
           ),
           'verification'
    FROM public.delivery_verifications v
    LEFT JOIN public.profiles pr ON pr.id = v.driver_id
    LEFT JOIN public.drivers d ON d.id = v.driver_id
    LEFT JOIN public.restaurants rs ON rs.id = v.restaurant_id
    LEFT JOIN public.partners pt ON pt.id = v.partner_id;
    RETURN;
  END IF;

  IF p_entity = 'restaurants' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', concat_ws(' · ', pt.name, z.name),
             'status', r.status::text,
             'active', CASE WHEN r.is_active THEN 'yes' ELSE 'no' END,
             'partner', coalesce(r.partner_id::text, ''),
             'zone', coalesce(r.zone_id::text, ''),
             'name', r.name
           ),
           'restaurant'
    FROM public.restaurants r
    LEFT JOIN public.partners pt ON pt.id = r.partner_id
    LEFT JOIN public.zones z ON z.id = r.zone_id;
    RETURN;
  END IF;

  IF p_entity = 'zones' THEN
    RETURN QUERY
    SELECT z.id::text,
           jsonb_build_object(
             'id', z.id,
             'label', z.name,
             'sublabel', z.code,
             'status', z.zone_type::text,
             'zoneType', z.zone_type::text,
             'name', z.name
           ),
           'zone'
    FROM public.zones z;
    RETURN;
  END IF;

  IF p_entity = 'partners' THEN
    RETURN QUERY
    SELECT p.id::text,
           jsonb_build_object(
             'id', p.id,
             'label', p.name,
             'sublabel', p.slug,
             'status', '',
             'name', p.name
           ),
           'partner'
    FROM public.partners p;
    RETURN;
  END IF;

  IF p_entity = 'companies' THEN
    RETURN QUERY
    SELECT c.key,
           jsonb_build_object(
             'id', c.key,
             'label', c.name,
             'sublabel', c.key,
             'status', CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END,
             'active', CASE WHEN c.is_active THEN 'yes' ELSE 'no' END,
             'name', c.name
           ),
           'company'
    FROM public.source_companies c
    WHERE c.is_system IS NOT TRUE;
    RETURN;
  END IF;

  IF p_entity = 'driver_groups' THEN
    RETURN QUERY
    SELECT g.id::text,
           jsonb_build_object(
             'id', g.id,
             'label', g.name,
             'sublabel', coalesce(g.description, ''),
             'status', '',
             'name', g.name
           ),
           'driver_group'
    FROM public.driver_groups g;
    RETURN;
  END IF;

  IF p_entity = 'assets' THEN
    RETURN QUERY
    SELECT a.id::text,
           jsonb_build_object(
             'id', a.id,
             'label', a.name,
             'sublabel', concat_ws(' · ', nullif(a.code, ''), nullif(a.category, '')),
             'status', CASE WHEN a.is_active THEN 'active' ELSE 'inactive' END,
             'category', coalesce(a.category, ''),
             'active', CASE WHEN a.is_active THEN 'yes' ELSE 'no' END,
             'name', a.name
           ),
           'asset'
    FROM public.asset_catalog a;
    RETURN;
  END IF;

  IF p_entity = 'delivery_rules' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', r.scope_type::text,
             'status', r.status::text,
             'scopeType', r.scope_type::text,
             'name', r.name
           ),
           'delivery_rule'
    FROM public.delivery_rules r;
    RETURN;
  END IF;

  IF p_entity = 'incentive_rules' THEN
    RETURN QUERY
    SELECT r.id::text,
           jsonb_build_object(
             'id', r.id,
             'label', r.name,
             'sublabel', concat_ws(' · ', r.scope_type::text, r.period::text),
             'status', r.status::text,
             'scopeType', r.scope_type::text,
             'period', r.period::text,
             'name', r.name
           ),
           'incentive_rule'
    FROM public.incentive_rules r;
    RETURN;
  END IF;

  RAISE EXCEPTION 'unknown_entity' USING ERRCODE = '22023';
END;
$$;

/* ------------------------------------------------------------------ */
/* 6. Matched set — the one place filters are applied                  */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.admin_purge_matched_rows(p_entity text, p_filters jsonb)
RETURNS TABLE(purge_id text, row_json jsonb, purge_kind text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.purge_id, s.row_json, s.purge_kind
  FROM public.admin_purge_rows_of(p_entity) s
  WHERE p_filters IS NULL
     OR p_filters = 'null'::jsonb
     OR p_filters = '{}'::jsonb
     OR public.admin_purge_row_matches(p_entity, s.row_json, p_filters);
$$;

-- Labels for the id-valued list columns. Only the columns whose stored value is
-- a key rather than a human-readable string need an entry; everything else is
-- its own label.
CREATE OR REPLACE FUNCTION public.admin_purge_value_labels(p_entity text, p_column text)
RETURNS TABLE(value text, label text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_column = 'zone' THEN
    RETURN QUERY SELECT z.id::text, z.name FROM public.zones z;
    RETURN;
  END IF;
  IF p_column = 'partner' THEN
    RETURN QUERY SELECT p.id::text, p.name FROM public.partners p;
    RETURN;
  END IF;
  IF p_column = 'restaurant' THEN
    RETURN QUERY SELECT r.id::text, r.name FROM public.restaurants r;
    RETURN;
  END IF;
  IF p_entity = 'esign' AND p_column = 'category' THEN
    RETURN QUERY SELECT c.key, c.label_en FROM public.esign_categories c;
    RETURN;
  END IF;
  IF p_entity = 'visits' AND p_column = 'department' THEN
    RETURN QUERY SELECT d.key, coalesce(nullif(d.label_en, ''), d.key) FROM public.visit_departments d;
    RETURN;
  END IF;
  RETURN;
END;
$$;

/* ------------------------------------------------------------------ */
/* 7. Gated reads                                                      */
/* ------------------------------------------------------------------ */

-- Distinct values for one column, honouring every other active filter (the
-- column's own filter is dropped first, exactly as the drivers list facets do).
CREATE OR REPLACE FUNCTION public.admin_purge_filtered_values(
  p_entity text,
  p_column text,
  p_filters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_rest jsonb;
  v_out jsonb;
BEGIN
  PERFORM public._admin_purge_require_super_admin();
  v_kind := public.admin_purge_filter_kind_of(p_entity, p_column);
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
  END IF;
  -- A range column has no list of values to offer.
  IF v_kind = 'range' THEN
    RETURN '[]'::jsonb;
  END IF;
  PERFORM public.admin_purge_validate_filters(p_entity, p_filters);
  v_rest := coalesce(p_filters, '{}'::jsonb) - p_column;

  IF p_entity = 'drivers' THEN
    -- Drivers reuses the list page's own facet resolver, over both the live and
    -- the archived tab, so the purge offers exactly the values the list offers.
    WITH merged AS (
      SELECT x->>'value' AS value, min(coalesce(x->>'label', '')) AS label
      FROM jsonb_array_elements(
        public.admin_drivers_filter_values(p_column, 'all', NULL, v_rest)
        || public.admin_drivers_filter_values(p_column, 'archived', NULL, v_rest)
      ) x
      GROUP BY 1
    )
    SELECT coalesce(jsonb_agg(
             jsonb_build_object('value', value, 'label', coalesce(nullif(label, ''), value))
             ORDER BY (value = ''), lower(coalesce(nullif(label, ''), value))
           ), '[]'::jsonb)
    INTO v_out
    FROM merged
    WHERE value IS NOT NULL;
    RETURN v_out;
  END IF;

  WITH vals AS (
    SELECT DISTINCT coalesce(public.admin_purge_value_text(s.row_json->p_column), '') AS value
    FROM public.admin_purge_matched_rows(p_entity, v_rest) s
  )
  SELECT coalesce(jsonb_agg(
           jsonb_build_object('value', v.value, 'label', coalesce(nullif(l.label, ''), v.value))
           ORDER BY (v.value = ''), lower(coalesce(nullif(l.label, ''), v.value))
         ), '[]'::jsonb)
  INTO v_out
  FROM vals v
  LEFT JOIN public.admin_purge_value_labels(p_entity, p_column) l ON l.value = v.value;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

-- `{count, breakdown, blockers, sample}`. The blocker set is deliberately the
-- same two Clear all reports (scoped here to the matched ids rather than to the
-- whole table), because every other foreign key that points at these tables is
-- released by the delete path instead: the run must never refuse a purge that
-- Clear all would have performed.
CREATE OR REPLACE FUNCTION public.admin_purge_filtered_preview(p_entity text, p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_sample jsonb := '[]'::jsonb;
  v_blockers text[] := ARRAY[]::text[];
  v_ids uuid[];
BEGIN
  PERFORM public._admin_purge_require_super_admin();
  PERFORM public.admin_purge_validate_filters(p_entity, p_filters);

  SELECT coalesce(sum(b.n), 0)::integer,
         coalesce(jsonb_object_agg(b.purge_kind, b.n), '{}'::jsonb)
  INTO v_count, v_breakdown
  FROM (
    SELECT m.purge_kind, count(*)::integer AS n
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m
    GROUP BY 1
  ) b;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.purge_id,
           'label', coalesce(s.row_json->>'label', ''),
           'sublabel', coalesce(s.row_json->>'sublabel', ''),
           'status', coalesce(s.row_json->>'status', ''),
           'kind', s.purge_kind
         )), '[]'::jsonb)
  INTO v_sample
  FROM (
    SELECT m.* FROM public.admin_purge_matched_rows(p_entity, p_filters) m
    ORDER BY m.purge_id
    LIMIT 8
  ) s;

  IF p_entity = 'restaurants' THEN
    SELECT coalesce(array_agg(m.purge_id::uuid), '{}') INTO v_ids
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m;
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.restaurant_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_deliveries');
    END IF;
    IF EXISTS (SELECT 1 FROM public.drivers d WHERE d.restaurant_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_drivers');
    END IF;

  ELSIF p_entity = 'zones' THEN
    SELECT coalesce(array_agg(m.purge_id::uuid), '{}') INTO v_ids
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m;
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.zone_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_deliveries');
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.zone_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_restaurants');
    END IF;
    -- The per-id purger refuses a zone an intake still points at. Without this
    -- the preview would clear and the delete would raise mid-run.
    IF EXISTS (SELECT 1 FROM public.driver_intakes di WHERE di.zone_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_intakes');
    END IF;

  ELSIF p_entity = 'vehicles' THEN
    SELECT coalesce(array_agg(m.purge_id::uuid), '{}') INTO v_ids
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m;
    -- `fuel_fills.vehicle_id` is ON DELETE RESTRICT, and a fill is a record of
    -- fuel bought for a specific vehicle: nulling it to get the vehicle out
    -- would destroy attribution the operator never selected. Clear all refuses
    -- a fleet with any fill at all; here the refusal is scoped to the vehicles
    -- actually matched.
    IF EXISTS (SELECT 1 FROM public.fuel_fills f WHERE f.vehicle_id = ANY(v_ids)) THEN
      v_blockers := array_append(v_blockers, 'blocked_by_fuel');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'count', v_count,
    'breakdown', v_breakdown,
    'blockers', to_jsonb(v_blockers),
    'sample', v_sample
  );
END;
$$;

-- `{rows, total, hasMore}` — the read-only review list.
CREATE OR REPLACE FUNCTION public.admin_purge_filtered_page(
  p_entity text,
  p_filters jsonb,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(coalesce(p_limit, 50), 200));
  v_offset integer := GREATEST(0, coalesce(p_offset, 0));
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._admin_purge_require_super_admin();
  PERFORM public.admin_purge_validate_filters(p_entity, p_filters);

  SELECT count(*)::integer INTO v_total
  FROM public.admin_purge_matched_rows(p_entity, p_filters);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.purge_id,
           'label', coalesce(s.row_json->>'label', ''),
           'sublabel', coalesce(s.row_json->>'sublabel', ''),
           'status', coalesce(s.row_json->>'status', ''),
           'kind', s.purge_kind
         )), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT m.* FROM public.admin_purge_matched_rows(p_entity, p_filters) m
    ORDER BY m.purge_id
    LIMIT v_limit OFFSET v_offset
  ) s;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'hasMore', (v_offset + v_limit) < v_total
  );
END;
$$;

/* ------------------------------------------------------------------ */
/* 8. Gated delete                                                     */
/* ------------------------------------------------------------------ */

-- One batch of the matched set. The delete path is deliberately the Clear all
-- path: per-id purgers where they exist (so the R2 prefixes and the Auth-user
-- manifest cannot drift), the same child-first inline deletes otherwise, and
-- nothing beyond it — a filtered purge must be no more destructive than
-- emptying the module, only narrower.
CREATE OR REPLACE FUNCTION public.admin_purge_filtered_run(
  p_entity text,
  p_filters jsonb,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(coalesce(p_limit, 500), 500));
  v_preview jsonb;
  v_blockers text[];
  v_ids text[] := ARRAY[]::text[];
  v_kinds text[] := ARRAY[]::text[];
  v_uuid_ids uuid[];
  v_driver_ids uuid[];
  v_intake_ids uuid[];
  v_result jsonb := '{}'::jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_deleted integer := 0;
  v_remaining integer := 0;
BEGIN
  PERFORM public._admin_purge_require_super_admin();
  PERFORM public.admin_purge_validate_filters(p_entity, p_filters);

  v_preview := public.admin_purge_filtered_preview(p_entity, p_filters);
  v_blockers := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_preview->'blockers', '[]'::jsonb)));
  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'deleted', 0,
      'remaining', coalesce((v_preview->>'count')::integer, 0),
      'blockers', to_jsonb(v_blockers),
      'storage_keys', '[]'::jsonb,
      'manifest', '[]'::jsonb
    );
  END IF;

  SELECT array_agg(s.id_text ORDER BY s.id_text), array_agg(s.purge_kind ORDER BY s.id_text)
  INTO v_ids, v_kinds
  FROM (
    SELECT m.purge_id AS id_text, m.purge_kind
    FROM public.admin_purge_matched_rows(p_entity, p_filters) m
    ORDER BY m.purge_id
    LIMIT v_limit
  ) s;

  IF coalesce(cardinality(v_ids), 0) > 0 THEN

    IF p_entity = 'drivers' THEN
      v_driver_ids := ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'driver');
      v_intake_ids := ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'intake');
      IF cardinality(v_driver_ids) > 0 THEN
        v_result := public.admin_purge_drivers(v_driver_ids);
      END IF;
      IF cardinality(v_intake_ids) > 0 THEN
        v_extra := public.admin_purge_intakes(v_intake_ids);
        v_result := v_result
          || jsonb_build_object('storage_keys',
               coalesce(v_result->'storage_keys', '[]'::jsonb)
               || coalesce(v_extra->'storage_prefixes', '[]'::jsonb));
      END IF;

    ELSIF p_entity = 'deliveries' THEN
      v_result := public.admin_purge_deliveries(v_ids::uuid[]);

    ELSIF p_entity = 'restaurants' THEN
      v_result := public.admin_purge_restaurants(v_ids::uuid[]);

    ELSIF p_entity = 'zones' THEN
      v_result := public.admin_purge_zones(v_ids::uuid[]);

    ELSIF p_entity = 'assets' THEN
      v_result := public.admin_purge_asset_catalog(v_ids::uuid[]);

    ELSIF p_entity = 'delivery_rules' THEN
      v_result := public.admin_purge_delivery_rules(v_ids::uuid[]);

    ELSIF p_entity = 'incentive_rules' THEN
      v_result := public.admin_purge_incentive_rules(v_ids::uuid[]);

    ELSIF p_entity = 'vehicles' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.drivers SET vehicle_id = NULL, updated_at = now()
      WHERE vehicle_id = ANY(v_uuid_ids);
      UPDATE public.driver_intakes SET vehicle_id = NULL WHERE vehicle_id = ANY(v_uuid_ids);
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
      WHERE id = ANY(v_uuid_ids);
      -- Any matched vehicle with a fuel fill was already refused by the preview,
      -- so `fuel_fills` is never touched here: a fill's vehicle link is the
      -- record of which vehicle the fuel went into.
      DELETE FROM public.vehicles WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'attendance' THEN
      v_uuid_ids := v_ids::uuid[];
      -- `driver_sessions` has no `ended_at`; a live duty row is one that has not
      -- been signed out. Leaving it open beside a deleted log is the state that
      -- keeps the rider reading Clocked In with nothing behind it.
      DELETE FROM public.driver_sessions
      WHERE went_offline_at IS NULL
        AND driver_id IN (SELECT al.driver_id FROM public.attendance_logs al WHERE al.id = ANY(v_uuid_ids));
      DELETE FROM public.attendance_logs WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'earnings' THEN
      DELETE FROM public.driver_earnings_daily
      WHERE id = ANY(ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'earnings_daily'));
      DELETE FROM public.driver_wallet_entries
      WHERE id = ANY(ARRAY(SELECT u::uuid FROM unnest(v_ids, v_kinds) AS t(u, k) WHERE k = 'wallet'));

    ELSIF p_entity = 'payouts' THEN
      -- `driver_payouts.run_id` is ON DELETE CASCADE, so each run takes its own
      -- payment rows with it.
      DELETE FROM public.payout_runs WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'requests' THEN
      DELETE FROM public.requests WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'visits' THEN
      v_uuid_ids := v_ids::uuid[];
      -- A booking by another rider rescheduled off one of these visits is NO
      -- ACTION and would hold the row in place.
      UPDATE public.visit_bookings SET rescheduled_from_id = NULL
      WHERE rescheduled_from_id = ANY(v_uuid_ids);
      DELETE FROM public.visit_bookings WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'notifications' THEN
      DELETE FROM public.notification_campaigns WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'esign' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.esign_batch_rows SET esign_request_id = NULL
      WHERE esign_request_id = ANY(v_uuid_ids);
      DELETE FROM public.esign_requests WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'fuel' THEN
      -- Deliberately not the Clear all behaviour of wiping fuel_withdrawn_
      -- overrides: those are per rider / vehicle / month, not per fill, and a
      -- narrow purge must not delete rows the operator did not select.
      DELETE FROM public.fuel_fills WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'wrong_actions' THEN
      DELETE FROM public.wrong_actions WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'documents' THEN
      DELETE FROM public.document_tracking WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'order_recon' THEN
      DELETE FROM public.order_recon_runs WHERE id = ANY(v_ids::uuid[]);

    ELSIF p_entity = 'verifications' THEN
      v_uuid_ids := v_ids::uuid[];
      -- `verification_balances.last_verification_id` is NO ACTION. The balance
      -- is a running total per rider, not a child of one verification, so the
      -- link is released rather than the balance deleted.
      UPDATE public.verification_balances SET last_verification_id = NULL
      WHERE last_verification_id = ANY(v_uuid_ids);
      DELETE FROM public.delivery_verifications WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'partners' THEN
      v_uuid_ids := v_ids::uuid[];
      UPDATE public.restaurants SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.drivers SET partner_id = NULL, updated_at = now() WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.driver_intakes SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      UPDATE public.deliveries SET partner_id = NULL WHERE partner_id = ANY(v_uuid_ids);
      DELETE FROM public.partners WHERE id = ANY(v_uuid_ids);

    ELSIF p_entity = 'companies' THEN
      UPDATE public.drivers SET source_company = NULL, updated_at = now()
      WHERE source_company = ANY(v_ids);
      UPDATE public.driver_intakes SET source_company = NULL
      WHERE source_company = ANY(v_ids);
      PERFORM set_config('mggo.allow_company_purge', 'on', true);
      DELETE FROM public.source_companies
      WHERE key = ANY(v_ids) AND is_system IS NOT TRUE;

    ELSIF p_entity = 'driver_groups' THEN
      DELETE FROM public.driver_groups WHERE id = ANY(v_ids::uuid[]);

    ELSE
      RAISE EXCEPTION 'unknown_entity' USING ERRCODE = '22023';
    END IF;

    v_deleted := cardinality(v_ids);
  END IF;

  SELECT count(*)::integer INTO v_remaining
  FROM public.admin_purge_matched_rows(p_entity, p_filters);

  RETURN jsonb_build_object(
    'deleted', coalesce(v_deleted, 0),
    'remaining', coalesce(v_remaining, 0),
    'blockers', '[]'::jsonb,
    'storage_keys', coalesce(v_result->'storage_keys', v_result->'storage_prefixes', '[]'::jsonb),
    'manifest', coalesce(v_result->'manifest', '[]'::jsonb)
  );
END;
$$;

/* ------------------------------------------------------------------ */
/* 9. Grants                                                           */
/* ------------------------------------------------------------------ */

-- `DROP FUNCTION` does not carry an ACL, and Postgres grants EXECUTE to PUBLIC
-- by default, so the whole surface is restated here — including the helpers,
-- which are only ever reached from inside a SECURITY DEFINER wrapper.

REVOKE ALL ON FUNCTION public.admin_drivers_column_value(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_drivers_filter_kind(text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_purge_value_text(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_value_in(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_value_in_range(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_col_matches(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filter_kind_of(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_validate_filters(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_vehicle_filter_rows() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_row_value(text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_row_matches(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_rows_of(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_matched_rows(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_value_labels(text, text) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_purge_filter_columns(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filtered_values(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filtered_preview(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filtered_page(text, jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_purge_filtered_run(text, jsonb, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_purge_filter_columns(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_filtered_values(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_filtered_preview(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_filtered_page(text, jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_filtered_run(text, jsonb, integer) TO authenticated;
