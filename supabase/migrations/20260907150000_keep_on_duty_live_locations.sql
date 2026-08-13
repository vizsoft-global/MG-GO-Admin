-- Keep last-known GPS for drivers who are still on duty.
-- The live map needs those coords when the app pauses reporting (indoor /
-- coarse GPS / OEM-killed foreground task). Off-duty stale rows still go.

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
        AND d.is_on_duty = true
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_stale_driver_locations(interval) IS
  'Delete stale GPS rows except for drivers who are still on duty (last-known pin).';
