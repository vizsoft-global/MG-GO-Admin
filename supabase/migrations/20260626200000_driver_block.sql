-- Admin block/unblock for drivers: separate from account status (active/suspended/pending).
-- Blocked drivers cannot sign in; the mobile app shows blocked_reason.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES auth.users(id);

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_blocked_reason_chk;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_blocked_reason_chk CHECK (
    (NOT is_blocked)
    OR (blocked_reason IS NOT NULL AND length(btrim(blocked_reason)) >= 3)
  );

COMMENT ON COLUMN public.drivers.is_blocked IS
  'When true, driver mobile app login and in-app actions are denied.';
COMMENT ON COLUMN public.drivers.blocked_reason IS
  'Message shown to the driver when blocked (required while is_blocked = true).';

CREATE OR REPLACE FUNCTION public.set_driver_blocked(
  p_driver_id uuid,
  p_blocked boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_found');
  END IF;

  IF p_blocked THEN
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL OR length(v_reason) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_block_reason');
    END IF;

    UPDATE public.drivers
    SET
      is_blocked = true,
      blocked_reason = v_reason,
      blocked_at = now(),
      blocked_by = auth.uid(),
      is_on_duty = false,
      updated_at = now()
    WHERE id = p_driver_id;
  ELSE
    UPDATE public.drivers
    SET
      is_blocked = false,
      blocked_reason = NULL,
      blocked_at = NULL,
      blocked_by = NULL,
      updated_at = now()
    WHERE id = p_driver_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_driver_blocked(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_driver_blocked(uuid, boolean, text) TO authenticated;

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
  v_code text;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  v_code := btrim(p_driver_code);

  SELECT id, status, driver_code, archived_at, is_blocked, blocked_reason
  INTO v_driver
  FROM public.drivers
  WHERE driver_code = v_code
    AND app_passcode = p_passcode
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_driver.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_archived');
  END IF;

  IF v_driver.is_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'driver_blocked',
      'message', v_driver.blocked_reason
    );
  END IF;

  IF v_driver.status <> 'active'::public.driver_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_active');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_driver.id,
    'driver_code', v_driver.driver_code
  );
END;
$$;
