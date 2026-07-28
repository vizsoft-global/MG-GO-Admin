-- Remove stale live-location rows (>10 min without GPS update).
-- Safe for the driver app: driver_report_location upserts on the next report.
-- Does NOT touch is_on_duty, driver_sessions, attendance, or device sessions.

CREATE OR REPLACE FUNCTION public.cleanup_stale_driver_locations(
  p_max_age interval DEFAULT interval '10 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.driver_locations
  WHERE last_seen_at < now() - p_max_age;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stale_driver_locations(interval) TO service_role;
