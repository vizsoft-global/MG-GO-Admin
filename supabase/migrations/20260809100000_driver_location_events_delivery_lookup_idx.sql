-- Speed up delivery detail GPS audit lookups (by delivery_id or active_delivery_id).

CREATE INDEX IF NOT EXISTS driver_location_events_delivery_id_recorded_idx
  ON public.driver_location_events (delivery_id, recorded_at DESC)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS driver_location_events_active_delivery_id_recorded_idx
  ON public.driver_location_events (active_delivery_id, recorded_at DESC)
  WHERE active_delivery_id IS NOT NULL;
