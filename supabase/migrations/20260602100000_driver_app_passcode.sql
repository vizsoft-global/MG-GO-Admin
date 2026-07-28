-- Driver app passcode: 6-digit numeric PIN used by riders to log into the mobile app.
-- Auto-generated when a driver becomes `active`. Plaintext (admin staff can read & share
-- with the driver). Replaces OTP as the rider-app primary credential.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS app_passcode text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_app_passcode_format_chk;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_app_passcode_format_chk
  CHECK (app_passcode IS NULL OR app_passcode ~ '^[0-9]{6}$');

CREATE UNIQUE INDEX IF NOT EXISTS drivers_app_passcode_unique_idx
  ON public.drivers (app_passcode)
  WHERE app_passcode IS NOT NULL;

-- Helper: cryptographically-random 6-digit code as zero-padded text. Uses pgcrypto
-- (already available in Supabase) so codes are uniform across the 000000..999999 space.
CREATE OR REPLACE FUNCTION public.generate_driver_app_passcode()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_attempt int := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    -- 4 random bytes -> uint32 mod 1_000_000 keeps the distribution effectively uniform
    -- (max bias < 1 in 4000 across the space, acceptable for a 6-digit PIN).
    v_code := lpad(
      (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text,
      6,
      '0'
    );

    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE app_passcode = v_code) THEN
      RETURN v_code;
    END IF;

    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'driver_passcode_collision_retry_exceeded';
    END IF;
  END LOOP;
END;
$$;

-- Trigger: when a driver transitions into status='active' and has no passcode yet,
-- mint one before the row is written. Also fires on INSERT if the driver is created
-- active outright.
CREATE OR REPLACE FUNCTION public.drivers_assign_passcode_on_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'::public.driver_status AND NEW.app_passcode IS NULL THEN
    NEW.app_passcode := public.generate_driver_app_passcode();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_assign_passcode_on_active_trg ON public.drivers;
CREATE TRIGGER drivers_assign_passcode_on_active_trg
  BEFORE INSERT OR UPDATE OF status ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.drivers_assign_passcode_on_active();

-- Backfill: every currently-active driver without a passcode gets one immediately.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.drivers
    WHERE status = 'active'::public.driver_status AND app_passcode IS NULL
  LOOP
    UPDATE public.drivers
    SET app_passcode = public.generate_driver_app_passcode(),
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Admin RPC: regenerate a driver's passcode (also use this to mint one for a non-active
-- driver if admin chooses to). Staff-only via `is_admin_panel_user()`.
CREATE OR REPLACE FUNCTION public.regenerate_driver_app_passcode(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  v_code := public.generate_driver_app_passcode();

  UPDATE public.drivers
  SET app_passcode = v_code,
      updated_at = now()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('ok', true, 'passcode', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_driver_app_passcode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_driver_app_passcode(uuid) TO authenticated;

-- Mobile-app login RPC: given a driver_code + passcode, return the auth.users id so the
-- rider app can complete sign-in (e.g. exchange for a session via service-role token or
-- magic-link). Rate-limited at the application layer; returns ok=false on any mismatch
-- so callers cannot distinguish "wrong code" from "wrong passcode".
CREATE OR REPLACE FUNCTION public.driver_app_lookup_by_passcode(
  p_driver_code text,
  p_passcode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver record;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  SELECT id, status
  INTO v_driver
  FROM public.drivers
  WHERE upper(trim(driver_code)) = upper(trim(p_driver_code))
    AND app_passcode = p_passcode
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_driver.status <> 'active'::public.driver_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_active');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_driver.id,
    'driver_code', p_driver_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_app_lookup_by_passcode(text, text) FROM PUBLIC;
-- Anon role so the mobile app can call this from the login screen before having a session.
GRANT EXECUTE ON FUNCTION public.driver_app_lookup_by_passcode(text, text) TO anon, authenticated;

COMMENT ON COLUMN public.drivers.app_passcode IS
  '6-digit numeric PIN used by the driver mobile app for sign-in. Auto-assigned on transition to active.';
