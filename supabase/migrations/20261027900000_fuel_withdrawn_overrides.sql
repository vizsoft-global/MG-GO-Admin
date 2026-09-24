-- Admin fuel log can replace the computed month total (sum of fuel_fills) for one rider + vehicle.
-- The driver app does not read this table.

CREATE TABLE IF NOT EXISTS public.fuel_withdrawn_overrides (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  month_key text NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  amount_kwd numeric(12,3) NOT NULL CHECK (amount_kwd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (driver_id, vehicle_id, month_key)
);

ALTER TABLE public.fuel_withdrawn_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_withdrawn_overrides_staff_select ON public.fuel_withdrawn_overrides;
CREATE POLICY fuel_withdrawn_overrides_staff_select
  ON public.fuel_withdrawn_overrides FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS fuel_withdrawn_overrides_staff_write ON public.fuel_withdrawn_overrides;
CREATE POLICY fuel_withdrawn_overrides_staff_write
  ON public.fuel_withdrawn_overrides FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

GRANT SELECT, INSERT, UPDATE ON public.fuel_withdrawn_overrides TO authenticated;
