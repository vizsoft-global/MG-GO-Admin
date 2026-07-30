-- Login photo gate exemptions: per-driver + global kill-switch.
-- Phase-1 soft RPC unchanged (no liveness RAISE).

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS login_verification_exempt boolean NOT NULL DEFAULT false;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS driver_app_login_verification_exempt_all
    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.drivers.login_verification_exempt IS
  'When true, this driver skips daily login selfie gate. Set via Admin only.';
COMMENT ON COLUMN public.app_settings.driver_app_login_verification_exempt_all IS
  'When true, ALL drivers skip daily login selfie gate. Set via Admin Driver App settings.';
