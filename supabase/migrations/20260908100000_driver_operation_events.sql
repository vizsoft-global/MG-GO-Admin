-- Driver operations control tower: one append-only stream for every driver app
-- state change. Live Tracking could only ever show GPS because the 49 driver_*
-- RPCs write their domain table and nothing else, so admin could not replay what
-- a driver did, when, or in what order.
--
-- Two emitters, because driver RPCs signal failure in two different ways:
--   log_driver_operation            - same transaction. Correct for successes and
--                                     for RPCs that RETURN {ok:false,...} (the
--                                     transaction commits, so the row survives).
--   log_driver_operation_autonomous - separate connection via dblink. Only for
--                                     RPCs that RAISE, where the audit row would
--                                     otherwise be rolled back with the caller.
--                                     Restricted to low-volume operations; never
--                                     wire it into driver_report_location or
--                                     driver_heartbeat (one loopback connection
--                                     per call would exhaust the pool).

CREATE TABLE public.driver_operation_events (
  -- bigserial, not uuid: high-volume ordered append, and (occurred_at, id) is the
  -- keyset cursor for the admin feed.
  id                bigserial PRIMARY KEY,
  driver_id         uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  category          text NOT NULL,
  operation_key     text NOT NULL,
  source            text NOT NULL DEFAULT 'rpc',
  source_name       text,
  success           boolean NOT NULL DEFAULT true,
  error_code        text,
  entity_type       text,
  entity_id         uuid,
  context           jsonb NOT NULL DEFAULT '{}'::jsonb,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  device_id         text,
  app_version_code  integer,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);

-- Deliberately no CHECK constraint on category/source. Both emitters swallow
-- exceptions so the caller is never affected, which means a constraint violation
-- would silently DROP the audit row instead of failing loudly. A typo'd category
-- that is visible in the feed is far better than an event that vanishes.
COMMENT ON COLUMN public.driver_operation_events.category IS
  'auth|duty|location|delivery|request|esign|visit|notification|profile|upload|device|security|admin_action. Free text on purpose - see migration note.';
COMMENT ON COLUMN public.driver_operation_events.source IS 'rpc|api|edge|trigger|cron|admin';
COMMENT ON COLUMN public.driver_operation_events.context IS 'Small payload for feed display. No PII.';

CREATE INDEX driver_operation_events_occurred_idx
  ON public.driver_operation_events (occurred_at DESC, id DESC);
CREATE INDEX driver_operation_events_driver_idx
  ON public.driver_operation_events (driver_id, occurred_at DESC, id DESC);
CREATE INDEX driver_operation_events_category_idx
  ON public.driver_operation_events (category, occurred_at DESC, id DESC);
CREATE INDEX driver_operation_events_failures_idx
  ON public.driver_operation_events (occurred_at DESC, id DESC) WHERE success = false;

ALTER TABLE public.driver_operation_events ENABLE ROW LEVEL SECURITY;

-- Append-only by omission: staff read, and no INSERT/UPDATE/DELETE policy exists
-- for anyone. Both emitters are SECURITY DEFINER so they bypass RLS; a driver
-- therefore cannot forge, edit or erase their own audit trail.
CREATE POLICY driver_operation_events_staff_select
  ON public.driver_operation_events
  FOR SELECT
  USING (public.is_admin_panel_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_operation_events;

-- ---------------------------------------------------------------------------
-- In-transaction emitter (successes + RPCs that RETURN an error object)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_driver_operation(
  p_driver_id     uuid,
  p_category      text,
  p_operation_key text,
  p_source        text DEFAULT 'rpc',
  p_source_name   text DEFAULT NULL,
  p_success       boolean DEFAULT true,
  p_error_code    text DEFAULT NULL,
  p_entity_type   text DEFAULT NULL,
  p_entity_id     uuid DEFAULT NULL,
  p_context       jsonb DEFAULT '{}'::jsonb,
  p_latitude      numeric DEFAULT NULL,
  p_longitude     numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id text;
  v_version   integer;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN;
  END IF;

  SELECT d.active_device_id, d.current_app_version_code
  INTO v_device_id, v_version
  FROM public.drivers d
  WHERE d.id = p_driver_id;

  INSERT INTO public.driver_operation_events (
    driver_id, category, operation_key, source, source_name,
    success, error_code, entity_type, entity_id, context,
    latitude, longitude, device_id, app_version_code
  ) VALUES (
    p_driver_id, p_category, p_operation_key, coalesce(p_source, 'rpc'), p_source_name,
    coalesce(p_success, true), p_error_code, p_entity_type, p_entity_id,
    coalesce(p_context, '{}'::jsonb),
    p_latitude, p_longitude, v_device_id, v_version
  );
EXCEPTION WHEN others THEN
  -- Best-effort audit, never block the main action. plpgsql wraps this block in
  -- an implicit savepoint, so only the failed INSERT is undone - the caller's
  -- own work is untouched.
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.log_driver_operation(
  uuid, text, text, text, text, boolean, text, text, uuid, jsonb, numeric, numeric
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.log_driver_operation(
  uuid, text, text, text, text, boolean, text, text, uuid, jsonb, numeric, numeric
) IS
  'Best-effort in-transaction driver operation audit. Callable only from SECURITY DEFINER RPCs. Use log_driver_operation_autonomous for paths that RAISE.';

-- ---------------------------------------------------------------------------
-- Autonomous emitter (RPCs that RAISE, low-volume allowlist only)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

-- The DSN lives in Vault and is created OUT OF BAND by an operator, because it
-- carries the database password and must never reach git:
--
--   select vault.create_secret(
--     'postgresql://postgres:<PASSWORD>@db.eoksxkdssptgyqyywdju.supabase.co:5432/postgres',
--     'driver_ops_audit_dsn',
--     'Loopback DSN for autonomous driver operation failure audit');
--
-- Port 5432 (direct), not 6543 (pooler): looping back through the pooler can
-- deadlock when the pool is saturated. Until the secret exists this function is
-- a no-op, so this migration is safe to deploy first. NOTE: rotating the
-- database password also requires updating this secret.
CREATE OR REPLACE FUNCTION public.log_driver_operation_autonomous(
  p_driver_id     uuid,
  p_category      text,
  p_operation_key text,
  p_source_name   text,
  p_error_code    text,
  p_context       jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dsn text;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_dsn
  FROM vault.decrypted_secrets
  WHERE name = 'driver_ops_audit_dsn';

  IF v_dsn IS NULL THEN
    RETURN;
  END IF;

  -- format(%L) quotes SQLERRM and context, so neither can inject SQL.
  PERFORM extensions.dblink_exec(
    v_dsn,
    format(
      'insert into public.driver_operation_events
         (driver_id, category, operation_key, source, source_name, success, error_code, context, device_id, app_version_code)
       values (%L, %L, %L, %L, %L, false, %L, %L::jsonb, %L, %s)',
      p_driver_id, p_category, p_operation_key, 'rpc', p_source_name,
      p_error_code, coalesce(p_context, '{}'::jsonb),
      (SELECT active_device_id FROM public.drivers WHERE id = p_driver_id),
      coalesce((SELECT current_app_version_code::text FROM public.drivers WHERE id = p_driver_id), 'null')
    ),
    false   -- fail_on_error = false
  );
EXCEPTION WHEN others THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.log_driver_operation_autonomous(
  uuid, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.log_driver_operation_autonomous(
  uuid, text, text, text, text, jsonb
) IS
  'Writes a failure audit row over a dblink loopback so it survives the caller RAISE-triggered rollback. Low-volume allowlist only - never call from driver_report_location or driver_heartbeat.';
