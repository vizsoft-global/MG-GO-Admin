-- 20261113000000_fuel_list_driver_scope.sql
--
-- The per-driver fuel page (/fuel/drivers/[id]) listed the *whole fleet* and
-- then filtered in JavaScript:
--
--   listFuelFills({ ..., p_limit: 2000 })   -- fleet-wide, newest first
--   rows.filter((row) => row.driver_id === input.driverId)
--
-- A custom range for one rider therefore came back empty whenever the fleet had
-- more than 2000 fills inside the window: the rider's own rows were past the
-- LIMIT, so the JS filter had nothing left to keep. The failure looked like
-- "no fuel records" on a rider who plainly had them, which is the worst kind of
-- empty state — it names no cause.
--
-- `p_driver_id` is pushed into the RPC so the LIMIT applies *after* scoping.
-- The parameter is trailing with a DEFAULT, so the fleet list (/fuel) and every
-- other caller keep working unchanged; only the driver page passes it.
--
-- The previous 7-argument signature is dropped rather than left alongside,
-- because two overloads would make a named-argument call ambiguous through
-- PostgREST. CREATE OR REPLACE would have preserved the grant on that body, but
-- DROP loses it, so the REVOKE/GRANT pair is restated at the end.

DROP FUNCTION IF EXISTS public.admin_list_fuel_fills(
  date, date, text, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.admin_list_fuel_fills(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_project_key text DEFAULT NULL,
  p_vehicle_type_key text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_driver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('fuel.view') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_from IS NOT NULL THEN
    v_from := (p_from::timestamp AT TIME ZONE 'Asia/Kuwait');
  END IF;
  IF p_to IS NOT NULL THEN
    v_to := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.fuel_fills f
  JOIN public.drivers d ON d.id = f.driver_id
  JOIN public.vehicles v ON v.id = f.vehicle_id
  LEFT JOIN public.profiles p ON p.id = d.id
  WHERE (v_from IS NULL OR f.filled_at >= v_from)
    AND (v_to IS NULL OR f.filled_at < v_to)
    AND (p_driver_id IS NULL OR f.driver_id = p_driver_id)
    AND (p_project_key IS NULL OR d.project_key = p_project_key)
    AND (p_vehicle_type_key IS NULL OR v.vehicle_type_key = p_vehicle_type_key)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR p.full_name ILIKE '%' || p_search || '%'
      OR d.driver_code ILIKE '%' || p_search || '%'
      OR d.employee_id ILIKE '%' || p_search || '%'
      OR v.reg_number ILIKE '%' || p_search || '%'
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.filled_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      f.id,
      f.filled_at,
      f.litres,
      f.cost_kwd,
      f.station_name,
      f.lat,
      f.lng,
      f.driver_id,
      p.full_name AS driver_name,
      d.driver_code,
      d.employee_id,
      d.project_key,
      d.accommodation,
      f.vehicle_id,
      v.reg_number AS plate,
      v.vehicle_type_key AS kind,
      v.model,
      v.make,
      v.fuel_type,
      v.fuel_company,
      v.chip_no,
      v.fuel_monthly_limit_kwd,
      op.name AS vehicle_company,
      emp.name AS employee_company,
      z.name AS zone_name,
      CASE
        WHEN v.fuel_monthly_limit_kwd IS NULL OR v.fuel_monthly_limit_kwd = 0 THEN NULL
        ELSE round((f.cost_kwd / v.fuel_monthly_limit_kwd) * 100, 1)
      END AS utilisation_pct,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'kind', a.kind,
          'title', a.title,
          'file_name', a.file_name,
          'storage_key', a.storage_key,
          'captured_at', a.captured_at,
          'source', a.source
        ) ORDER BY a.kind)
        FROM public.fuel_fill_attachments a
        WHERE a.fill_id = f.id
      ), '[]'::jsonb) AS attachments
    FROM public.fuel_fills f
    JOIN public.drivers d ON d.id = f.driver_id
    JOIN public.vehicles v ON v.id = f.vehicle_id
    LEFT JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.partners op ON op.id = v.owner_partner_id
    LEFT JOIN public.partners emp ON emp.id = d.partner_id
    LEFT JOIN public.zones z ON z.id = d.zone_id
    WHERE (v_from IS NULL OR f.filled_at >= v_from)
      AND (v_to IS NULL OR f.filled_at < v_to)
      AND (p_driver_id IS NULL OR f.driver_id = p_driver_id)
      AND (p_project_key IS NULL OR d.project_key = p_project_key)
      AND (p_vehicle_type_key IS NULL OR v.vehicle_type_key = p_vehicle_type_key)
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || p_search || '%'
        OR d.driver_code ILIKE '%' || p_search || '%'
        OR d.employee_id ILIKE '%' || p_search || '%'
        OR v.reg_number ILIKE '%' || p_search || '%'
      )
    ORDER BY f.filled_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0), 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_fuel_fills(
  date, date, text, text, text, integer, integer, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_fuel_fills(
  date, date, text, text, text, integer, integer, uuid
) TO authenticated;
