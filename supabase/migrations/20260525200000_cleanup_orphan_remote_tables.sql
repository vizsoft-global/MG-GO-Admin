-- Remove tables created by one-off remote migrations not tracked in this repo.
-- Admin panel uses public.deliveries (not delivery_records), zones.polygon (not zone_geofences), etc.

DROP TABLE IF EXISTS public.driver_intake_documents CASCADE;
DROP TABLE IF EXISTS public.driver_zone_presence CASCADE;
DROP TABLE IF EXISTS public.vehicle_driver_assignments CASCADE;
DROP TABLE IF EXISTS public.vehicle_documents CASCADE;
DROP TABLE IF EXISTS public.zone_geofences CASCADE;
DROP TABLE IF EXISTS public.delivery_records CASCADE;
DROP TABLE IF EXISTS public.fuel_expenses CASCADE;
DROP TABLE IF EXISTS public.duty_states CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.export_jobs CASCADE;
