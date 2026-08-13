-- Keep last-known GPS for every active driver, including offline / off-duty.
-- Live Tracking's Offline chip needs those coords; the previous cleanup
-- deleted off-duty rows after 10 minutes so they vanished from list and map.

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
  DELETE FROM public.driver_locations loc
  WHERE loc.last_seen_at < now() - p_max_age
    AND NOT EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = loc.driver_id
        AND d.archived_at IS NULL
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_stale_driver_locations(interval) IS
  'Delete stale GPS rows only for archived / missing drivers. Active drivers keep last-known pin (including Offline).';
