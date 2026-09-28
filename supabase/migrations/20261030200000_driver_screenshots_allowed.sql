-- Per-driver screenshot / screen-record allow. Default OFF.
-- When true the rider app must not apply FLAG_SECURE or capture-blocked UI,
-- including screenshot_restricted notification and e-sign sessions.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS screenshots_allowed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.drivers.screenshots_allowed IS
  'When true, this rider may screenshot and screen-record the whole app. Set via Admin only. Default false.';

UPDATE public.drivers
SET screenshots_allowed = true
WHERE employee_id = '108899'
   OR driver_code = '108899';
