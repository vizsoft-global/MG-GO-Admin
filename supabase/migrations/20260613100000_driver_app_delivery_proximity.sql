-- Universal max distance (meters) from assigned zone or restaurant when logging deliveries in the driver app.
-- 0 = disabled (no proximity check).

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_delivery_proximity_meters integer NOT NULL DEFAULT 500;

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_delivery_proximity_range;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_delivery_proximity_range
  CHECK (driver_app_delivery_proximity_meters >= 0 AND driver_app_delivery_proximity_meters <= 10000);

COMMENT ON COLUMN public.app_settings.driver_app_delivery_proximity_meters IS
  'Max meters from assigned zone boundary or assigned restaurant when driver submits a delivery. 0 disables the check.';
