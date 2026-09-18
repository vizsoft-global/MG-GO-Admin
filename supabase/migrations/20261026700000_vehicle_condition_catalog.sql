-- Widen vehicles.condition to the fleet catalog (screenshot 8 + kept accident).
-- Additive CHECK only: no UPDATE / backfill. Existing running / repair_required /
-- accident / standby rows stay valid. type_of_use.standby is a different column.

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_condition_check;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_condition_check
  CHECK (
    condition IS NULL
    OR condition IN (
      'running',
      'inventory_assembled',
      'sold',
      'deadstock',
      'stolen',
      'repair_required',
      'standby',
      'police_custody',
      'accident'
    )
  );

COMMENT ON COLUMN public.vehicles.condition IS
  'Mechanical / incident state. Not type_of_use and not vehicle_status.';
