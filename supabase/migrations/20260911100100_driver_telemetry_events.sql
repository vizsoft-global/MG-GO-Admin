-- Phase 3: driver app client telemetry.
--
-- Phase 1 answers "what did the driver DO" (driver_operation_events: business
-- operations, realtime, 90 day retention). It cannot answer "what was happening
-- on the phone at the time" - which screen was open, whether location permission
-- was refused, whether the device was offline and queued. That context is what
-- turns "the delivery never arrived" into a diagnosis.
--
-- Deliberately a separate stream, not extra rows in driver_operation_events:
--   * volume is an order of magnitude higher, so it must not flood the Activity
--     feed or the realtime channel every admin client subscribes to;
--   * it needs its own (much shorter) retention;
--   * it is written by the client, so it needs an allowlist, a quota and payload
--     sanitising that business RPCs do not.
--
-- Nothing in Phase 1/2 is touched by this migration.

-- ---------------------------------------------------------------------------
-- Allowlist: which event names exist, and which context keys each may carry
-- ---------------------------------------------------------------------------

CREATE TABLE public.driver_telemetry_event_types (
  name         text PRIMARY KEY,
  category     text NOT NULL,
  label        text,
  is_active    boolean NOT NULL DEFAULT true,
  -- The permitted context keys for this one event. Anything else the app sends
  -- is stripped by _telemetry_sanitize_context. This is a data-driven contract:
  -- withdrawing a key that turned out to be sensitive is an UPDATE, not a deploy.
  context_keys text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.driver_telemetry_event_types IS
  'Allowlist for driver_telemetry_events. Bounds event-name cardinality and the permitted context keys per event.';
COMMENT ON COLUMN public.driver_telemetry_event_types.context_keys IS
  'Permitted context keys. Keys outside this list are stripped server-side, never stored.';

ALTER TABLE public.driver_telemetry_event_types ENABLE ROW LEVEL SECURITY;

-- Staff may read and toggle the allowlist (that is the no-deploy kill switch).
-- Riders get no policy at all: the app never needs to read it, and the ingest
-- RPC is SECURITY DEFINER so it reads the table regardless.
CREATE POLICY driver_telemetry_event_types_staff_select
  ON public.driver_telemetry_event_types
  FOR SELECT
  USING (public.is_admin_panel_user());

CREATE POLICY driver_telemetry_event_types_staff_update
  ON public.driver_telemetry_event_types
  FOR UPDATE
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

-- Bounded names with the detail in context (screen.open + context.screen), not
-- one name per screen - otherwise the allowlist grows with every app screen and
-- stops being an allowlist.
INSERT INTO public.driver_telemetry_event_types (name, category, label, context_keys) VALUES
  ('app.startup',                      'lifecycle',    'App started',              ARRAY['cold_start','boot_ms']),
  ('app.foreground',                   'lifecycle',    'App foreground',           ARRAY['screen','duration_ms']),
  ('app.background',                   'lifecycle',    'App background',           ARRAY['screen','duration_ms']),
  ('app.client_info',                  'lifecycle',    'Client info',              ARRAY['platform','os_version','device_model','app_version_name','app_version_code','locale']),
  ('screen.open',                      'screen',       'Screen opened',            ARRAY['screen','from_screen','load_ms']),
  ('action.tap',                       'action',       'Action tapped',            ARRAY['action','screen','result']),
  ('permission.location_granted',      'permission',   'Location granted',         ARRAY['status','screen','is_permanent','attempt']),
  ('permission.location_denied',       'permission',   'Location denied',          ARRAY['status','screen','is_permanent','attempt']),
  ('permission.notification_granted',  'permission',   'Notifications granted',    ARRAY['status','screen','is_permanent','attempt']),
  ('permission.notification_denied',   'permission',   'Notifications denied',     ARRAY['status','screen','is_permanent','attempt']),
  ('permission.camera_denied',         'permission',   'Camera denied',            ARRAY['status','screen','is_permanent','attempt']),
  ('network.offline',                  'network',      'Went offline',             ARRAY['network_state','offline_ms']),
  ('network.online',                   'network',      'Back online',              ARRAY['network_state','offline_ms']),
  ('queue.created',                    'queue',        'Offline queue created',    ARRAY['queue','depth','dropped','reason']),
  ('queue.flushed',                    'queue',        'Offline queue flushed',    ARRAY['queue','depth','batch_count','flush_ms','reason']),
  -- No message and no stack key on purpose: a stable short code is diagnosable,
  -- a raw error string is an unbounded PII channel. Full errors belong in the
  -- app's own crash reporter.
  ('client.error',                     'client_error', 'Client error',             ARRAY['code','screen','http_status','retryable'])
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The stream
-- ---------------------------------------------------------------------------

CREATE TABLE public.driver_telemetry_events (
  id                   bigserial PRIMARY KEY,
  driver_id            uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  -- Client-generated at enqueue time. This is what makes a retried batch
  -- idempotent instead of duplicating the whole flush.
  event_id             uuid NOT NULL,
  event_name           text NOT NULL REFERENCES public.driver_telemetry_event_types(name),
  category             text NOT NULL,
  -- Both clocks, because a driver phone with a wrong date would otherwise
  -- silently reorder the timeline with no way to notice.
  client_ts            timestamptz NOT NULL,
  server_received_at   timestamptz NOT NULL DEFAULT now(),
  clock_skew_ms        integer,
  session_id           text,
  correlation_id       text,
  platform             text,
  app_version_name     text,
  app_version_code     integer,
  device_id            text,
  network_state        text,
  severity             text NOT NULL DEFAULT 'info',
  context              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- How many keys the server removed. A build sending keys we do not permit is
  -- then visible in Admin instead of quietly losing half its context.
  context_stripped_keys smallint NOT NULL DEFAULT 0,
  CONSTRAINT driver_telemetry_events_event_id_key UNIQUE (driver_id, event_id)
);

COMMENT ON TABLE public.driver_telemetry_events IS
  'Append-only driver app client telemetry. Written only by driver_ingest_telemetry; no client role may insert, update or delete.';
COMMENT ON COLUMN public.driver_telemetry_events.context IS
  'Sanitised payload: per-event key allowlist, key denylist, scalars only, bounded values. Never PII.';
COMMENT ON COLUMN public.driver_telemetry_events.clock_skew_ms IS
  'client_ts - server_received_at in ms. Positive = device clock ahead.';

CREATE INDEX driver_telemetry_events_client_ts_idx
  ON public.driver_telemetry_events (client_ts DESC, id DESC);
CREATE INDEX driver_telemetry_events_driver_idx
  ON public.driver_telemetry_events (driver_id, client_ts DESC, id DESC);
CREATE INDEX driver_telemetry_events_category_idx
  ON public.driver_telemetry_events (category, client_ts DESC, id DESC);
-- The quota probe counts a single driver's very recent rows.
CREATE INDEX driver_telemetry_events_quota_idx
  ON public.driver_telemetry_events (driver_id, server_received_at DESC);
CREATE INDEX driver_telemetry_events_errors_idx
  ON public.driver_telemetry_events (client_ts DESC, id DESC) WHERE severity = 'error';

ALTER TABLE public.driver_telemetry_events ENABLE ROW LEVEL SECURITY;

-- Append-only by omission, exactly like driver_operation_events: staff SELECT
-- and no INSERT/UPDATE/DELETE policy for anyone. A driver can therefore never
-- edit or erase their own telemetry, nor read anyone else's.
CREATE POLICY driver_telemetry_events_staff_select
  ON public.driver_telemetry_events
  FOR SELECT
  USING (public.is_admin_panel_user());

-- Deliberately NOT added to supabase_realtime. Client telemetry is high volume;
-- broadcasting it to every admin client is exactly what section 9 of the plan
-- rules out. The Diagnostics tab polls on demand instead.

-- ---------------------------------------------------------------------------
-- Context sanitiser - the enforcement behind the documented PII rules
-- ---------------------------------------------------------------------------

-- Returns {"context": <surviving object>, "stripped": <keys removed>}.
--
-- Four rules, in order:
--   1. per-event key allowlist  (driver_telemetry_event_types.context_keys)
--   2. key denylist, applied even to allowlisted keys
--   3. scalars only - nested objects/arrays are dropped, which is what
--      structurally prevents a stack trace, a headers map or a request body
--   4. value bounds - strings truncated, identifier-shaped keys pattern-checked
--
-- This is not a content scanner. It is an allowlist with a small denylist behind
-- it, which is why it stays cheap enough to run on every ingested event.
CREATE OR REPLACE FUNCTION public._telemetry_sanitize_context(
  p_event_name text,
  p_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Substring match. None of the seeded allowlist keys contain any of these.
  c_banned_substring constant text :=
    '(token|password|passcode|secret|bearer|jwt|refresh|phone|mobile|msisdn|civil|national_id|iqama|address|street|email|stack|traceback|message|cookie|payload|header|body|auth)';
  -- Needs word boundaries rather than substring: "platform" contains "lat", and
  -- "app_version_code" would survive but "pin" must not match "shipping".
  c_banned_word constant text :=
    '(^|_)(pin|otp|lat|lng|latitude|longitude|iban|dob)(_|$)';
  -- Keys that must read as a stable identifier, never free text. This is what
  -- stops a full error sentence or a phone number riding in on a legal key.
  -- Deliberately excludes the app.client_info descriptors (device_model
  -- "Pixel 9", os_version "15", app_version_name "1.4.2", locale "en_US"):
  -- none of them are lower_snake_case, so the pattern would strip every one.
  -- They stay bounded by the 120-character truncation instead.
  c_identifier_keys constant text[] :=
    ARRAY['screen','from_screen','action','code','queue','reason','result','status','network_state'];
  c_max_string constant integer := 120;

  v_allowed text[];
  v_out     jsonb := '{}'::jsonb;
  v_stripped integer := 0;
  v_key     text;
  v_value   jsonb;
  v_text    text;
BEGIN
  IF p_context IS NULL OR pg_catalog.jsonb_typeof(p_context) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('context', '{}'::jsonb, 'stripped', 0);
  END IF;

  SELECT t.context_keys INTO v_allowed
  FROM public.driver_telemetry_event_types t
  WHERE t.name = p_event_name;

  FOR v_key, v_value IN
    SELECT e.key, e.value FROM pg_catalog.jsonb_each(p_context) AS e
  LOOP
    -- 1. per-event allowlist
    IF v_allowed IS NULL OR NOT (v_key = ANY (v_allowed)) THEN
      v_stripped := v_stripped + 1;
      CONTINUE;
    END IF;

    -- 2. denylist, even for allowlisted keys (survives a mis-seeded allowlist)
    IF pg_catalog.lower(v_key) ~ c_banned_substring
       OR pg_catalog.lower(v_key) ~ c_banned_word THEN
      v_stripped := v_stripped + 1;
      CONTINUE;
    END IF;

    -- 3. scalars only
    IF pg_catalog.jsonb_typeof(v_value) NOT IN ('string', 'number', 'boolean', 'null') THEN
      v_stripped := v_stripped + 1;
      CONTINUE;
    END IF;

    -- 4. value bounds
    IF pg_catalog.jsonb_typeof(v_value) = 'string' THEN
      v_text := p_context ->> v_key;

      IF v_key = ANY (c_identifier_keys)
         AND NOT (v_text ~ '^[a-z][a-z0-9_.\-]{0,63}$') THEN
        v_stripped := v_stripped + 1;
        CONTINUE;
      END IF;

      v_out := v_out || pg_catalog.jsonb_build_object(
        v_key, pg_catalog.to_jsonb(pg_catalog.left(v_text, c_max_string))
      );
    ELSE
      v_out := v_out || pg_catalog.jsonb_build_object(v_key, v_value);
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('context', v_out, 'stripped', v_stripped);
END;
$$;

ALTER FUNCTION public._telemetry_sanitize_context(text, jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public._telemetry_sanitize_context(text, jsonb) IS
  'Internal. Applies the per-event context key allowlist, key denylist, scalars-only rule and value bounds. Called only by driver_ingest_telemetry.';

-- ---------------------------------------------------------------------------
-- Ingestion - one batched call, the only new grant to `authenticated`
-- ---------------------------------------------------------------------------

-- Returns a result object instead of raising, for two reasons: the app must be
-- able to tell "drop this event forever" from "retry later", and no autonomous
-- dblink audit may be involved on a high-volume client path.
CREATE OR REPLACE FUNCTION public.driver_ingest_telemetry(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_batch    constant integer := 100;
  c_max_context  constant integer := 1024;
  c_clock_window constant interval := interval '7 days';

  v_uid         uuid;
  v_found       boolean := false;
  v_device      text;
  v_version     integer;
  v_max_hour    integer;
  v_recent      integer;
  v_now         timestamptz := pg_catalog.now();

  v_count       integer;
  v_item        jsonb;
  v_event_id    uuid;
  v_name        text;
  v_category    text;
  v_active      boolean;
  v_client_ts   timestamptz;
  v_sanitized   jsonb;
  v_context     jsonb;
  v_stripped    integer;
  v_severity    text;

  v_rows        jsonb := '[]'::jsonb;
  v_staged      integer := 0;
  v_inserted    integer := 0;
  v_rejected    integer := 0;
  v_rejects     jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT true, d.active_device_id, d.current_app_version_code
  INTO v_found, v_device, v_version
  FROM public.drivers d
  WHERE d.id = v_uid;

  IF NOT COALESCE(v_found, false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'not_a_driver');
  END IF;

  IF p_events IS NULL OR pg_catalog.jsonb_typeof(p_events) <> 'array' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_payload');
  END IF;

  v_count := pg_catalog.jsonb_array_length(p_events);

  IF v_count > c_max_batch THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'batch_too_large');
  END IF;

  IF v_count = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'accepted', 0, 'duplicates', 0, 'rejected', 0,
      'throttled', false, 'rejects', '[]'::jsonb
    );
  END IF;

  -- Quota. Over the ceiling this returns ok/throttled rather than an error, so
  -- the app clears the batch instead of retry-looping against a closed door.
  SELECT s.driver_telemetry_max_events_per_hour INTO v_max_hour
  FROM public.app_settings s WHERE s.id = 1;
  v_max_hour := COALESCE(v_max_hour, 2000);

  SELECT pg_catalog.count(*) INTO v_recent
  FROM public.driver_telemetry_events e
  WHERE e.driver_id = v_uid
    AND e.server_received_at > v_now - interval '1 hour';

  IF v_recent >= v_max_hour THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'accepted', 0, 'duplicates', 0, 'rejected', 0,
      'throttled', true, 'rejects', '[]'::jsonb
    );
  END IF;

  FOR v_item IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_events) AS e
  LOOP
    v_event_id := NULL;
    v_name     := NULL;
    v_client_ts := NULL;

    BEGIN
      v_event_id := (v_item ->> 'event_id')::uuid;
      v_client_ts := (v_item ->> 'client_ts')::timestamptz;
    EXCEPTION WHEN others THEN
      v_event_id := NULL;
    END;

    v_name := v_item ->> 'event_name';

    IF v_event_id IS NULL OR v_client_ts IS NULL OR v_name IS NULL THEN
      v_rejected := v_rejected + 1;
      v_rejects := v_rejects || pg_catalog.jsonb_build_object(
        'event_id', v_item ->> 'event_id', 'reason', 'invalid_event'
      );
      CONTINUE;
    END IF;

    SELECT t.category, t.is_active INTO v_category, v_active
    FROM public.driver_telemetry_event_types t
    WHERE t.name = v_name;

    IF v_category IS NULL THEN
      v_rejected := v_rejected + 1;
      v_rejects := v_rejects || pg_catalog.jsonb_build_object(
        'event_id', v_event_id, 'reason', 'unknown_event_name'
      );
      CONTINUE;
    END IF;

    IF NOT v_active THEN
      v_rejected := v_rejected + 1;
      v_rejects := v_rejects || pg_catalog.jsonb_build_object(
        'event_id', v_event_id, 'reason', 'event_name_inactive'
      );
      CONTINUE;
    END IF;

    IF v_client_ts > v_now + c_clock_window OR v_client_ts < v_now - c_clock_window THEN
      v_rejected := v_rejected + 1;
      v_rejects := v_rejects || pg_catalog.jsonb_build_object(
        'event_id', v_event_id, 'reason', 'client_ts_out_of_range'
      );
      CONTINUE;
    END IF;

    -- Sanitise first, then measure: the 1024-char cap applies to what would
    -- actually be stored.
    v_sanitized := public._telemetry_sanitize_context(v_name, v_item -> 'context');
    v_context := v_sanitized -> 'context';
    v_stripped := (v_sanitized ->> 'stripped')::integer;

    IF pg_catalog.length(v_context::text) > c_max_context THEN
      v_rejected := v_rejected + 1;
      v_rejects := v_rejects || pg_catalog.jsonb_build_object(
        'event_id', v_event_id, 'reason', 'context_too_large'
      );
      CONTINUE;
    END IF;

    v_severity := pg_catalog.lower(COALESCE(v_item ->> 'severity', 'info'));
    IF v_severity NOT IN ('info', 'warn', 'error') THEN
      v_severity := 'info';
    END IF;
    IF v_name = 'client.error' THEN
      v_severity := 'error';
    END IF;

    v_rows := v_rows || pg_catalog.jsonb_build_object(
      'event_id', v_event_id,
      'event_name', v_name,
      'category', v_category,
      'client_ts', v_client_ts,
      -- date_part rather than EXTRACT(... FROM ...): the latter is parser sugar
      -- and cannot be written schema-qualified, which this function requires.
      'clock_skew_ms',
        (pg_catalog.date_part('epoch', v_client_ts - v_now) * 1000)::integer,
      'session_id', pg_catalog.left(v_item ->> 'session_id', 64),
      'correlation_id', pg_catalog.left(v_item ->> 'correlation_id', 64),
      'platform', pg_catalog.left(v_item ->> 'platform', 16),
      'app_version_name', pg_catalog.left(v_item ->> 'app_version_name', 32),
      'app_version_code', COALESCE((v_item ->> 'app_version_code')::integer, v_version),
      'network_state', pg_catalog.left(v_item ->> 'network_state', 16),
      'severity', v_severity,
      'context', v_context,
      'stripped', LEAST(v_stripped, 32767)
    );
    v_staged := v_staged + 1;
  END LOOP;

  IF v_staged > 0 THEN
    -- One statement for the whole batch. driver_id is always auth.uid(): a
    -- driver_id in the body is ignored, never read.
    INSERT INTO public.driver_telemetry_events (
      driver_id, event_id, event_name, category, client_ts, clock_skew_ms,
      session_id, correlation_id, platform, app_version_name, app_version_code,
      device_id, network_state, severity, context, context_stripped_keys
    )
    SELECT
      v_uid,
      (r.item ->> 'event_id')::uuid,
      r.item ->> 'event_name',
      r.item ->> 'category',
      (r.item ->> 'client_ts')::timestamptz,
      (r.item ->> 'clock_skew_ms')::integer,
      r.item ->> 'session_id',
      r.item ->> 'correlation_id',
      r.item ->> 'platform',
      r.item ->> 'app_version_name',
      (r.item ->> 'app_version_code')::integer,
      v_device,
      r.item ->> 'network_state',
      r.item ->> 'severity',
      COALESCE(r.item -> 'context', '{}'::jsonb),
      (r.item ->> 'stripped')::smallint
    FROM pg_catalog.jsonb_array_elements(v_rows) AS r(item)
    ON CONFLICT (driver_id, event_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'accepted', v_inserted,
    'duplicates', v_staged - v_inserted,
    'rejected', v_rejected,
    'throttled', false,
    'rejects', v_rejects
  );
END;
$$;

ALTER FUNCTION public.driver_ingest_telemetry(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.driver_ingest_telemetry(jsonb) IS
  'Batched client telemetry ingestion for the authenticated rider. Max 100 events, 1024-char sanitised context, hourly quota, idempotent on (driver_id, event_id).';

-- ---------------------------------------------------------------------------
-- Grants. Postgres gives EXECUTE to PUBLIC by default and Supabase roles
-- inherit it, so both functions are revoked explicitly first. Revoke before
-- grant, and repeat this block after any future DROP + recreate: CREATE OR
-- REPLACE keeps the ACL, a DROP resets it to the PUBLIC default.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.driver_ingest_telemetry(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_ingest_telemetry(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.driver_ingest_telemetry(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.driver_ingest_telemetry(jsonb) TO authenticated;

-- The sanitiser needs no grant at all: the ingest RPC runs as its definer
-- (postgres), which owns it, so the inner call succeeds while no client role
-- can reach it directly.
REVOKE ALL ON FUNCTION public._telemetry_sanitize_context(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._telemetry_sanitize_context(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._telemetry_sanitize_context(text, jsonb) FROM authenticated;
