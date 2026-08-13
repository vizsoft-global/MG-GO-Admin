-- Phase 3 retention, quota ceiling and permissions.
--
-- Telemetry retention is independent of Phase 1 on purpose: client events are an
-- order of magnitude more numerous than business operations and lose their
-- diagnostic value within days, whereas an audit trail of what a driver did is
-- kept for 90. driver_ops_log_retention_days and
-- driver_location_events_retention_days are not touched here.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_telemetry_retention_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS driver_telemetry_max_events_per_hour integer NOT NULL DEFAULT 2000;

COMMENT ON COLUMN public.app_settings.driver_telemetry_retention_days IS
  'Days of driver_telemetry_events to keep. Floored at 1 day by the cleanup RPC.';
COMMENT ON COLUMN public.app_settings.driver_telemetry_max_events_per_hour IS
  'Per-driver hourly ingest ceiling. 0 stops ingestion without a deploy (the app is told throttled, not error).';

-- Same batched shape as cleanup_driver_operation_events: a first run against a
-- backlog must not be one enormous transaction.
CREATE OR REPLACE FUNCTION public.cleanup_driver_telemetry_events(
  p_keep interval DEFAULT NULL,
  p_batch integer DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
  v_keep interval;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NOT NULL THEN
    v_keep := p_keep;
  ELSE
    SELECT s.driver_telemetry_retention_days INTO v_days
    FROM public.app_settings s WHERE s.id = 1;
    -- Floor at one day: a 0 in settings would otherwise mean "delete everything".
    v_keep := pg_catalog.make_interval(days => GREATEST(COALESCE(v_days, 14), 1));
  END IF;

  DELETE FROM public.driver_telemetry_events
  WHERE id IN (
    SELECT e.id FROM public.driver_telemetry_events e
    WHERE e.server_received_at < pg_catalog.now() - v_keep
    ORDER BY e.server_received_at
    LIMIT GREATEST(COALESCE(p_batch, 50000), 1)
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.cleanup_driver_telemetry_events(interval, integer) OWNER TO postgres;

-- Service role only. The PUBLIC EXECUTE default would let any signed-in rider
-- purge the diagnostics that explain their own app behaviour.
REVOKE ALL ON FUNCTION public.cleanup_driver_telemetry_events(interval, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_driver_telemetry_events(interval, integer) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_driver_telemetry_events(interval, integer) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Permissions: separate from driver_ops.* so telemetry access can be granted or
-- withdrawn without touching who can read the business audit trail.
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('driver_telemetry.view', 'View driver app diagnostics', 'drivers'),
  ('driver_telemetry.export', 'Export driver app diagnostics', 'drivers')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN (
  VALUES
    ('driver_telemetry.view'),
    ('driver_telemetry.export')
) AS p(slug)
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;
