-- Geofence operational settings and event audit trail (companion to public.zones)

CREATE TABLE public.zone_geofence_settings (
  zone_id uuid PRIMARY KEY REFERENCES public.zones(id) ON DELETE CASCADE,
  geofence_kind text NOT NULL DEFAULT 'inclusion'
    CHECK (geofence_kind IN ('inclusion', 'exclusion')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'draft')),
  description text,
  alert_on_entry boolean NOT NULL DEFAULT true,
  alert_on_exit boolean NOT NULL DEFAULT true,
  alert_on_dwell boolean NOT NULL DEFAULT false,
  dwell_time_seconds integer NOT NULL DEFAULT 300 CHECK (dwell_time_seconds >= 0),
  assign_to_all_drivers boolean NOT NULL DEFAULT true,
  driver_group_label text,
  notify_in_app boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT false,
  notify_sms boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.geofence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('entry', 'exit', 'dwell')),
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  accuracy_meters numeric(8, 2),
  source text NOT NULL DEFAULT 'tracking',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX geofence_events_zone_occurred_idx
  ON public.geofence_events (zone_id, occurred_at DESC);

CREATE INDEX geofence_events_driver_occurred_idx
  ON public.geofence_events (driver_id, occurred_at DESC);

CREATE INDEX geofence_events_type_occurred_idx
  ON public.geofence_events (event_type, occurred_at DESC);

ALTER TABLE public.zone_geofence_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY zone_geofence_settings_admin_select
  ON public.zone_geofence_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

CREATE POLICY zone_geofence_settings_admin_insert
  ON public.zone_geofence_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_panel_user());

CREATE POLICY zone_geofence_settings_admin_update
  ON public.zone_geofence_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

CREATE POLICY zone_geofence_settings_admin_delete
  ON public.zone_geofence_settings
  FOR DELETE
  TO authenticated
  USING (public.is_admin_panel_user());

CREATE POLICY geofence_events_admin_select
  ON public.geofence_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin_panel_user());

ALTER PUBLICATION supabase_realtime ADD TABLE public.zone_geofence_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.geofence_events;
