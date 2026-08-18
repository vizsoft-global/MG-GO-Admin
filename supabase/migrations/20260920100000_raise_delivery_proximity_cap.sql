-- Raise Allowed Distance so operators can test Add Delivery from outside
-- Kuwait (the previous 10 km CHECK made the app copy "within 10 km" a hard cap).
-- 0 still disables the gate. App reads the setting; no payload change.

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_driver_app_delivery_proximity_meters_check;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_driver_app_delivery_proximity_meters_check
  CHECK (
    driver_app_delivery_proximity_meters >= 0
    AND driver_app_delivery_proximity_meters <= 5000000
  );

COMMENT ON COLUMN public.app_settings.driver_app_delivery_proximity_meters IS
  'Max meters outside zone/restaurant for Add Delivery. 0 disables. Cap 5,000,000 m.';
