-- Employee ID mandatory on driver intakes + drivers: 1-8 digits, unique (non-archived intakes).

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS employee_id text;

-- Backfill drivers from driver_code where missing
UPDATE public.drivers
SET employee_id = driver_code
WHERE employee_id IS NULL OR trim(employee_id) = '';

-- Backfill intakes from driver_code where missing
UPDATE public.driver_intakes
SET employee_id = driver_code
WHERE employee_id IS NULL OR trim(employee_id) = '';

-- Sync linked intakes from drivers row
UPDATE public.driver_intakes di
SET employee_id = d.employee_id
FROM public.drivers d
WHERE di.linked_profile_id = d.id
  AND d.employee_id IS NOT NULL;

DROP INDEX IF EXISTS public.drivers_employee_id_unique;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_employee_id_format_chk;

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_employee_id_format_chk;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_employee_id_format_chk
  CHECK (employee_id ~ '^[0-9]{1,8}$');

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_employee_id_format_chk
  CHECK (employee_id ~ '^[0-9]{1,8}$');

CREATE UNIQUE INDEX IF NOT EXISTS drivers_employee_id_unique_idx
  ON public.drivers (employee_id);

CREATE UNIQUE INDEX IF NOT EXISTS driver_intakes_employee_id_unique_idx
  ON public.driver_intakes (employee_id)
  WHERE archived_at IS NULL;

ALTER TABLE public.drivers
  ALTER COLUMN employee_id SET NOT NULL;

ALTER TABLE public.driver_intakes
  ALTER COLUMN employee_id SET NOT NULL;

COMMENT ON COLUMN public.driver_intakes.employee_id IS
  'Mandatory 1-8 digit employee code; unique among non-archived intakes';
