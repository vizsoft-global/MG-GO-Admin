-- EmployeeDesk V2 — the employee block gains civil ID, joining date and accommodation.
--
-- The reference template design opens every document with a system-filled
-- employee block, and three of its rows had no token behind them: civil ID, the
-- joining date and accommodation. All three are columns the rider record already
-- carries (`drivers.civil_id`, `drivers.joined_at`, `drivers.accommodation`), so
-- this is not new data — it is three existing facts being made available to the
-- document renderer instead of requiring an author to retype them per send,
-- which is how a signed document ends up disagreeing with the rider's own file.
--
-- Additive and re-runnable. Older stored `esign_requests.employee_snapshot`
-- rows keep whatever keys they were written with, and the renderer treats a
-- missing key as absent rather than empty — so a document already sent prints
-- exactly what it printed, and no backfill is required or wanted.
--
-- The function body is identical to 20261027600000 apart from the three new
-- keys. `joined_at` is emitted as an ISO date (`YYYY-MM-DD`) rather than a
-- timestamp: the value is substituted into a printed contract and is also read
-- by the rider app, and an ISO date is the one form that both reads as a date
-- and parses without a locale assumption. A NULL stays NULL so the block can
-- omit the row instead of printing a dash on a document a person signs.

CREATE OR REPLACE FUNCTION public.esign_employee_snapshot(p_driver_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'company_name', COALESCE(
      NULLIF(btrim(d.source_company), ''),
      NULLIF(btrim(s.app_name), ''),
      'DPD'
    ),
    'employee_name', COALESCE(NULLIF(btrim(p.full_name), ''), d.driver_code, ''),
    'employee_id', COALESCE(d.employee_id, ''),
    'driver_code', COALESCE(d.driver_code, ''),
    'civil_id', NULLIF(btrim(COALESCE(d.civil_id, '')), ''),
    'joined_at', CASE
      WHEN d.joined_at IS NULL THEN NULL
      ELSE to_char(d.joined_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD')
    END,
    'accommodation', NULLIF(btrim(COALESCE(d.accommodation, '')), ''),
    'zone', z.name,
    'project', d.project_key,
    'nationality', d.nationality
  )
  FROM public.drivers d
  LEFT JOIN public.profiles p ON p.id = d.id
  LEFT JOIN public.zones z ON z.id = d.zone_id
  CROSS JOIN LATERAL (
    SELECT app_name FROM public.app_settings LIMIT 1
  ) s
  WHERE d.id = p_driver_id;
$$;
