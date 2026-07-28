-- Admin filter: drivers with multiple distinct devices in the last N days.

CREATE OR REPLACE FUNCTION public.admin_drivers_multi_device_recent(
  p_days integer DEFAULT 7
)
RETURNS TABLE (
  driver_id uuid,
  device_count bigint,
  latest_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    s.driver_id,
    COUNT(DISTINCT s.device_id)::bigint AS device_count,
    MAX(s.last_seen_at) AS latest_activity_at
  FROM public.driver_device_sessions s
  WHERE s.last_seen_at >= now() - (v_days || ' days')::interval
  GROUP BY s.driver_id
  HAVING COUNT(DISTINCT s.device_id) > 1
  ORDER BY latest_activity_at DESC;
END;
$function$;
