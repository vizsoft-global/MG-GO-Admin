-- P4 SECURITY FIX — a guard that was missing from a function P2 introduced.
--
-- `admin_resolve_incentive_targets` shipped in `20261102001000` as SECURITY
-- DEFINER with EXECUTE granted to `authenticated`. In this schema `authenticated`
-- includes riders, and the function had no staff check, so a rider session could
-- call it straight through PostgREST. `p_driver_ids IS NULL` means "every
-- driver", so the leak was the whole fleet's incentive resolution, not one row.
--
-- Proven on production before this fix, inside a rolled-back transaction, as
-- rider `00229432-63ad-4c67-9d43-cb5f1371d90a`:
--
--     is_admin_panel_user() = false
--     admin_resolve_incentive_targets(CURRENT_DATE, NULL)  -> 697 rows
--
-- Two sibling admin RPCs used as controls for the same session raised
-- `not_authorized` (`admin_attendance_analytics_daily`,
-- `admin_live_fleet_snapshot`), which is the posture this function should have
-- had from the start.
--
-- The implementation body is deliberately NOT rewritten. Converting the SQL
-- body to plpgsql to insert a guard would force every OUT parameter name
-- (`driver_id`, `rule_id`, `period`, `target_deliveries`) to be resolved against
-- the body's CTEs — avoidable risk in a security patch. Instead the existing
-- function is renamed to a private implementation and a thin guarded wrapper
-- takes over the public name, so the query text is preserved byte-for-byte.
--
-- Safe to do because the only caller is `admin_list_driver_performance`, which is
-- itself SECURITY DEFINER and staff-guarded (so the nested guard sees the real
-- staff caller and passes), and there are no TypeScript or driver-facing callers:
-- grep for `admin_resolve_incentive_targets` matches nothing under `src/`.
-- SECURITY DEFINER is retained so the wrapper can still read `incentive_rules`
-- and `drivers` past RLS for a legitimate staff session.

ALTER FUNCTION public.admin_resolve_incentive_targets(date, uuid[])
  RENAME TO _admin_resolve_incentive_targets_impl;

-- The implementation must never be reachable on its own — a rider who could name
-- it would walk straight around the wrapper.
REVOKE ALL ON FUNCTION public._admin_resolve_incentive_targets_impl(date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._admin_resolve_incentive_targets_impl(date, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._admin_resolve_incentive_targets_impl(date, uuid[]) FROM authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_incentive_targets(
  p_on_date date,
  p_driver_ids uuid[]
)
RETURNS TABLE (
  driver_id uuid,
  rule_id uuid,
  period public.incentive_period,
  target_deliveries integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT * FROM public._admin_resolve_incentive_targets_impl(p_on_date, p_driver_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_incentive_targets(date, uuid[]) TO authenticated;
