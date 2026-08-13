-- Retention for the two append-only driver streams, plus a health probe for the
-- autonomous audit path.
--
-- driver_location_events has had no TTL since it was created and is already at
-- ~329k rows. driver_operation_events will grow faster than that, so it gets a
-- TTL on day one rather than as a later rescue.
--
-- Both deletes are batched. A first run against 180+ days of accumulated GPS
-- history would otherwise be one enormous transaction; batching keeps every run
-- bounded and simply catches up over a few nights.
--
-- Service-role only. Postgres grants EXECUTE to PUBLIC by default, which would
-- have let any signed-in rider purge the audit trail that exists to hold them
-- to account.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_ops_log_retention_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS driver_location_events_retention_days integer NOT NULL DEFAULT 180;

COMMENT ON COLUMN public.app_settings.driver_ops_log_retention_days IS
  'Days of driver_operation_events to keep. Floored at 1 day by the cleanup RPC.';
COMMENT ON COLUMN public.app_settings.driver_location_events_retention_days IS
  'Days of driver_location_events (sampled GPS history) to keep. Floored at 1 day by the cleanup RPC.';

CREATE OR REPLACE FUNCTION public.cleanup_driver_operation_events(
  p_keep interval DEFAULT NULL,
  p_batch integer DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer;
  v_keep interval;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NOT NULL THEN
    v_keep := p_keep;
  ELSE
    SELECT driver_ops_log_retention_days INTO v_days
    FROM public.app_settings WHERE id = 1;
    -- Floor at one day: a 0 in settings would otherwise mean "delete everything".
    v_keep := make_interval(days => GREATEST(COALESCE(v_days, 90), 1));
  END IF;

  DELETE FROM public.driver_operation_events
  WHERE id IN (
    SELECT id FROM public.driver_operation_events
    WHERE occurred_at < now() - v_keep
    ORDER BY occurred_at
    LIMIT GREATEST(COALESCE(p_batch, 50000), 1)
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_driver_operation_events(interval, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_driver_location_events(
  p_keep interval DEFAULT NULL,
  p_batch integer DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer;
  v_keep interval;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NOT NULL THEN
    v_keep := p_keep;
  ELSE
    SELECT driver_location_events_retention_days INTO v_days
    FROM public.app_settings WHERE id = 1;
    v_keep := make_interval(days => GREATEST(COALESCE(v_days, 180), 1));
  END IF;

  DELETE FROM public.driver_location_events
  WHERE id IN (
    SELECT id FROM public.driver_location_events
    WHERE recorded_at < now() - v_keep
    ORDER BY recorded_at
    LIMIT GREATEST(COALESCE(p_batch, 50000), 1)
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_driver_location_events(interval, integer)
  FROM PUBLIC, anon, authenticated;

-- Health probe for log_driver_operation_autonomous. That function swallows every
-- error by design - a broken audit path must never break a delivery - which
-- means a rotated database password would silently stop recording delivery
-- failures with nothing to show it. This is how we find out.
CREATE OR REPLACE FUNCTION public.driver_ops_audit_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dsn text;
  v_probe text;
  v_error text;
BEGIN
  SELECT decrypted_secret INTO v_dsn
  FROM vault.decrypted_secrets
  WHERE name = 'driver_ops_audit_dsn';

  IF v_dsn IS NULL THEN
    RETURN jsonb_build_object(
      'configured', false,
      'reachable', false,
      'reason', 'secret_missing'
    );
  END IF;

  BEGIN
    SELECT r.v INTO v_probe
    FROM extensions.dblink(v_dsn, 'select 1') AS r(v text);
  EXCEPTION WHEN others THEN
    v_error := SQLERRM;
  END;

  RETURN jsonb_build_object(
    'configured', true,
    'reachable', v_error IS NULL AND v_probe = '1',
    'reason', v_error,
    'failures_24h', (
      SELECT count(*) FROM public.driver_operation_events
      WHERE success = false AND occurred_at > now() - interval '24 hours'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_ops_audit_health() FROM PUBLIC, anon, authenticated;
