-- Live Tracking V2 Class B events: thresholds derived from the position stream.
--
-- Deliberately NOT folded into driver_operation_events. That stream is documented as
-- the record of what the *driver did* — server-authored, audit-grade, 90 days, and
-- explicitly excluding hot paths. These rows are what the *fleet looked like*:
-- they are derived, they flap without hysteresis, and they lose their value in
-- weeks rather than months. Mixing them would contaminate the audit trail and the
-- Activity feed that reads it.
--
-- Class A driver actions (clock in/out, pickup, delivery, shift submit) are relayed
-- to the V2 page from driver_operation_events and are never re-emitted here.

CREATE TABLE IF NOT EXISTS public.fleet_events (
  id bigserial PRIMARY KEY,
  driver_id uuid NOT NULL REFERENCES public.drivers (id) ON DELETE CASCADE,
  event_key text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  status_before text,
  status_after text,
  -- km/h for overspeed, % for battery, minutes for idle. One column because the
  -- feed only ever shows one number per row, and the key says what it means.
  value numeric,
  zone_id uuid REFERENCES public.zones (id) ON DELETE SET NULL,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'edge',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fleet_events IS
  'Derived (Class B) fleet threshold events from the Live Tracking V2 edge hub. Service-role write, staff read.';
COMMENT ON COLUMN public.fleet_events.value IS
  'Scalar the event is about: km/h for overspeed, percent for battery, minutes for idle.';
COMMENT ON COLUMN public.fleet_events.source IS
  'edge for the Durable Object, sim for the simulator, server for a database-side evaluator.';

CREATE INDEX IF NOT EXISTS fleet_events_detected_idx
  ON public.fleet_events (detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fleet_events_driver_idx
  ON public.fleet_events (driver_id, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fleet_events_key_idx
  ON public.fleet_events (event_key, detected_at DESC, id DESC);
-- The alert strip only ever reads the loud rows; a partial index keeps that read
-- off the full history.
CREATE INDEX IF NOT EXISTS fleet_events_severe_idx
  ON public.fleet_events (detected_at DESC, id DESC)
  WHERE severity IN ('warning', 'critical');

ALTER TABLE public.fleet_events ENABLE ROW LEVEL SECURITY;

-- Append-only by omission, same as driver_operation_events: staff SELECT and no
-- write policy for any role. The writer is the service role, which bypasses RLS.
DROP POLICY IF EXISTS fleet_events_staff_select ON public.fleet_events;
CREATE POLICY fleet_events_staff_select
  ON public.fleet_events
  FOR SELECT
  USING (public.is_admin_panel_user());

REVOKE ALL ON TABLE public.fleet_events FROM anon;
GRANT SELECT ON TABLE public.fleet_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.fleet_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fleet_events_id_seq TO service_role;

-- In the publication so alerts have a second rail: if the edge WebSocket is down
-- the admin page still receives events over Supabase Realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'fleet_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_events;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Thresholds move out of the client. tracking-metrics.ts hardcodes 60 km/h and
-- the battery buckets are display-only constants; once the edge hub *acts* on a
-- number, changing it must not be a deploy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS fleet_overspeed_kmh integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS fleet_low_battery_pct integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS fleet_idle_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS fleet_gps_offline_seconds integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS fleet_zone_buffer_meters integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS fleet_stale_gps_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS fleet_shift_late_grace_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS fleet_events_retention_days integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.app_settings.fleet_overspeed_kmh IS
  'Speed above which the edge hub raises overspeed.start. One global number today; per-zone limits are a follow-up.';
COMMENT ON COLUMN public.app_settings.fleet_zone_buffer_meters IS
  'Hysteresis buffer for assigned-zone entry/exit so a driver parked on a boundary does not flap.';
COMMENT ON COLUMN public.app_settings.fleet_gps_offline_seconds IS
  'Silence after which a driver reads GPS Offline. At a 5s cadence this is ~18 missed reports.';
COMMENT ON COLUMN public.app_settings.fleet_stale_gps_seconds IS
  'Warning tier before GPS Offline: the pin is still shown live but flagged stale.';
COMMENT ON COLUMN public.app_settings.fleet_events_retention_days IS
  'Days of fleet_events to keep. Shorter than the 90-day operation audit by design.';

-- Now that the columns exist, the edge hub reads real values.
CREATE OR REPLACE FUNCTION public._fleet_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'delivery_proximity_meters', COALESCE(s.driver_app_delivery_proximity_meters, 500),
    'attendance_auto_checkout_minutes', COALESCE(s.attendance_auto_checkout_minutes, 45),
    'overspeed_kmh', COALESCE(s.fleet_overspeed_kmh, 60),
    'low_battery_pct', COALESCE(s.fleet_low_battery_pct, 20),
    'idle_minutes', COALESCE(s.fleet_idle_minutes, 5),
    'gps_offline_seconds', COALESCE(s.fleet_gps_offline_seconds, 90),
    'stale_gps_seconds', COALESCE(s.fleet_stale_gps_seconds, 30),
    'zone_buffer_meters', COALESCE(s.fleet_zone_buffer_meters, 25),
    'shift_late_grace_minutes', COALESCE(s.fleet_shift_late_grace_minutes, 10)
  )
  FROM public.app_settings s
  WHERE s.id = 1;
$function$;

-- ---------------------------------------------------------------------------
-- Batch writer for the edge hub.
--
-- One RPC per flush rather than one INSERT per event: a fleet-wide overspeed burst
-- must not turn into a request storm.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_fleet_events(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_inserted integer := 0;
BEGIN
  IF NOT public._fleet_caller_is_service_role() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'events_array_required');
  END IF;

  v_total := jsonb_array_length(p_events);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'inserted', 0);
  END IF;
  IF v_total > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_too_large', 'received', v_total);
  END IF;

  WITH parsed AS (
    SELECT
      NULLIF(e ->> 'driver_id', '')::uuid AS driver_id,
      NULLIF(trim(e ->> 'event_key'), '') AS event_key,
      lower(COALESCE(NULLIF(trim(e ->> 'severity'), ''), 'info')) AS severity,
      NULLIF(trim(e ->> 'status_before'), '') AS status_before,
      NULLIF(trim(e ->> 'status_after'), '') AS status_after,
      NULLIF(e ->> 'value', '')::numeric AS value,
      NULLIF(e ->> 'zone_id', '')::uuid AS zone_id,
      NULLIF(e ->> 'latitude', '')::numeric AS latitude,
      NULLIF(e ->> 'longitude', '')::numeric AS longitude,
      COALESCE(e -> 'context', '{}'::jsonb) AS context,
      COALESCE(NULLIF(e ->> 'detected_at', '')::timestamptz, now()) AS detected_at,
      COALESCE(NULLIF(trim(e ->> 'source'), ''), 'edge') AS source
    FROM jsonb_array_elements(p_events) AS e
  )
  INSERT INTO public.fleet_events (
    driver_id, event_key, severity, status_before, status_after, value,
    zone_id, latitude, longitude, context, detected_at, source
  )
  SELECT
    p.driver_id, p.event_key,
    CASE WHEN p.severity IN ('info', 'warning', 'critical') THEN p.severity ELSE 'info' END,
    p.status_before, p.status_after, p.value, p.zone_id, p.latitude, p.longitude,
    CASE WHEN jsonb_typeof(p.context) = 'object' THEN p.context ELSE '{}'::jsonb END,
    -- A clock-skewed edge must not write the future.
    LEAST(p.detected_at, now()), p.source
  FROM parsed p
  WHERE p.driver_id IS NOT NULL
    AND p.event_key IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = p.driver_id);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'received', v_total, 'inserted', v_inserted,
    'rejected', v_total - v_inserted
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_record_fleet_events(jsonb) IS
  'Service-role batch writer for derived fleet threshold events.';

REVOKE ALL ON FUNCTION public.admin_record_fleet_events(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_fleet_events(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_record_fleet_events(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_fleet_events(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Keyset feed, same shape as the Activity tab's driver_operation_events reader:
-- the stream is append-heavy, so an offset page would both skip and repeat rows
-- while an operator is reading it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_fleet_events(
  p_driver_id uuid DEFAULT NULL,
  p_event_keys text[] DEFAULT NULL,
  p_severities text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_cursor_detected_at timestamptz DEFAULT NULL,
  p_cursor_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_rows jsonb;
  v_count integer;
BEGIN
  IF NOT (public._fleet_caller_is_service_role() OR public.is_admin_panel_user()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT
    COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.detected_at DESC, x.id DESC), '[]'::jsonb),
    count(*)
  INTO v_rows, v_count
  FROM (
    SELECT
      e.id,
      e.driver_id,
      COALESCE(NULLIF(trim(p.full_name), ''), d.driver_code) AS driver_name,
      d.driver_code,
      e.event_key,
      e.severity,
      e.status_before,
      e.status_after,
      e.value,
      e.zone_id,
      z.name AS zone_name,
      e.latitude,
      e.longitude,
      e.context,
      e.detected_at,
      e.source
    FROM public.fleet_events e
    JOIN public.drivers d ON d.id = e.driver_id
    LEFT JOIN public.profiles p ON p.id = d.id
    LEFT JOIN public.zones z ON z.id = e.zone_id
    WHERE (p_driver_id IS NULL OR e.driver_id = p_driver_id)
      AND (p_event_keys IS NULL OR e.event_key = ANY (p_event_keys))
      AND (p_severities IS NULL OR e.severity = ANY (p_severities))
      AND (p_from IS NULL OR e.detected_at >= p_from)
      AND (p_to IS NULL OR e.detected_at <= p_to)
      AND (
        p_cursor_detected_at IS NULL
        OR e.detected_at < p_cursor_detected_at
        OR (e.detected_at = p_cursor_detected_at AND e.id < COALESCE(p_cursor_id, 9223372036854775807))
      )
    ORDER BY e.detected_at DESC, e.id DESC
    LIMIT v_limit + 1
  ) x;

  -- One extra row was fetched purely to answer has_more; drop it before returning.
  RETURN jsonb_build_object(
    'events', (
      SELECT COALESCE(jsonb_agg(t.el ORDER BY t.ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(el, ord)
      WHERE t.ord <= v_limit
    ),
    'has_more', v_count > v_limit
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_list_fleet_events(uuid, text[], text[], timestamptz, timestamptz, timestamptz, bigint, integer) IS
  'Keyset-paginated derived fleet event feed for Live Tracking V2.';

GRANT EXECUTE ON FUNCTION public.admin_list_fleet_events(
  uuid, text[], text[], timestamptz, timestamptz, timestamptz, bigint, integer
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention, folded into the existing 01:20 driver-ops cron rather than a new one.
-- Batched, so a first run against a backlog is not one enormous transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_fleet_events(
  p_keep interval DEFAULT NULL,
  p_batch integer DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_days integer;
  v_keep interval;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NOT NULL THEN
    v_keep := p_keep;
  ELSE
    SELECT s.fleet_events_retention_days INTO v_days
    FROM public.app_settings s WHERE s.id = 1;
    -- Floored at one day: a 0 in settings would otherwise mean "delete everything".
    v_keep := pg_catalog.make_interval(days => GREATEST(COALESCE(v_days, 30), 1));
  END IF;

  DELETE FROM public.fleet_events
  WHERE id IN (
    SELECT e.id FROM public.fleet_events e
    WHERE e.detected_at < pg_catalog.now() - v_keep
    ORDER BY e.detected_at
    LIMIT GREATEST(COALESCE(p_batch, 50000), 1)
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

ALTER FUNCTION public.cleanup_fleet_events(interval, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cleanup_fleet_events(interval, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_fleet_events(interval, integer) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_fleet_events(interval, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_fleet_events(interval, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Permissions: separate from driver_ops.* so a role can watch the live fleet
-- without being granted the driver audit trail.
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('fleet_events.view', 'View live fleet events', 'drivers')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'fleet_events.view'
FROM public.admin_roles r
WHERE r.slug IN ('super_admin', 'administrator', 'operator')
ON CONFLICT DO NOTHING;
