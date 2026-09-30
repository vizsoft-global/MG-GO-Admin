-- Additive driver_get_assigned_vehicle: identity fields + read-only ledger arrays.
-- Staff RLS on vehicle_* tables stays; riders read only through this DEFINER RPC.
-- Arrays carry date/notes/kind/has_file only — never storage_key or signed URLs.

CREATE OR REPLACE FUNCTION public.driver_get_assigned_vehicle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'vehicle_id', v.id,
    'plate', v.reg_number,
    'kind', v.vehicle_type_key,
    'fuel_type', v.fuel_type,
    'chip_no', v.chip_no,
    'fuel_monthly_limit_kwd', v.fuel_monthly_limit_kwd,
    'model', NULLIF(btrim(concat_ws(' ', v.make, v.model)), ''),
    'condition', v.condition,
    'type_of_use', v.type_of_use,
    'chassis_no', v.chassis_no,
    'model_year', v.model_year,
    'car_type', v.car_type,
    'status', v.status,
    'handovers', (
      SELECT coalesce(jsonb_agg(x.obj ORDER BY x.sort_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'at', to_char(h.handed_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
          'notes', h.notes,
          'kind', NULL,
          'has_file', h.storage_key IS NOT NULL
        ) AS obj,
        h.handed_at AS sort_at
        FROM public.vehicle_handovers h
        WHERE h.vehicle_id = v.id
        ORDER BY h.handed_at DESC
        LIMIT 20
      ) x
    ),
    'accidents', (
      SELECT coalesce(jsonb_agg(x.obj ORDER BY x.sort_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'at', to_char(a.occurred_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
          'notes', a.notes,
          'kind', a.severity,
          'has_file', a.storage_key IS NOT NULL
        ) AS obj,
        a.occurred_at AS sort_at
        FROM public.vehicle_accidents a
        WHERE a.vehicle_id = v.id
        ORDER BY a.occurred_at DESC
        LIMIT 20
      ) x
    ),
    'documents', (
      SELECT coalesce(jsonb_agg(x.obj ORDER BY x.sort_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'at', to_char(d.created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
          'notes', d.file_name,
          'kind', d.doc_type,
          'has_file', d.storage_key IS NOT NULL
        ) AS obj,
        d.created_at AS sort_at
        FROM public.vehicle_documents d
        WHERE d.vehicle_id = v.id
        ORDER BY d.created_at DESC
        LIMIT 20
      ) x
    ),
    'services', (
      SELECT coalesce(jsonb_agg(x.obj ORDER BY x.sort_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'at', to_char(s.serviced_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
          'notes', s.notes,
          'kind', s.kind,
          'has_file', false
        ) AS obj,
        s.serviced_at AS sort_at
        FROM public.vehicle_services s
        WHERE s.vehicle_id = v.id
        ORDER BY s.serviced_at DESC
        LIMIT 20
      ) x
    ),
    'assets', (
      SELECT coalesce(jsonb_agg(x.obj ORDER BY x.sort_at DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'at', to_char(aa.assigned_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
          'notes', aa.notes,
          'kind', NULLIF(btrim(concat_ws(' · ', ac.name, ac.code)), ''),
          'has_file', false
        ) AS obj,
        aa.assigned_at AS sort_at
        FROM public.asset_assignments aa
        JOIN public.asset_catalog ac ON ac.id = aa.catalog_item_id
        WHERE aa.driver_id = v_uid
          AND aa.status = 'assigned'
        ORDER BY aa.assigned_at DESC
        LIMIT 20
      ) x
    )
  )
  INTO v_row
  FROM public.drivers d
  JOIN public.vehicles v ON v.id = d.vehicle_id
  WHERE d.id = v_uid
    AND d.archived_at IS NULL;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_get_assigned_vehicle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_get_assigned_vehicle() TO authenticated;
