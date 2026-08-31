-- Employee ID is the unique match key for a rider: letters and digits, 1–100
-- characters. Unique on lower(employee_id) so EMP1 and emp1 cannot both exist.
-- Login lookup is case-insensitive on employee_id; driver_code stays exact.

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_employee_id_format_chk;

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_employee_id_format_chk;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_employee_id_format_chk
  CHECK (employee_id ~ '^[A-Za-z0-9]{1,100}$');

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_employee_id_format_chk
  CHECK (employee_id ~ '^[A-Za-z0-9]{1,100}$');

DROP INDEX IF EXISTS public.drivers_employee_id_unique_idx;
DROP INDEX IF EXISTS public.driver_intakes_employee_id_unique_idx;

CREATE UNIQUE INDEX drivers_employee_id_unique_idx
  ON public.drivers (lower(employee_id));

CREATE UNIQUE INDEX driver_intakes_employee_id_unique_idx
  ON public.driver_intakes (lower(employee_id))
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.drivers.employee_id IS
  'Mandatory 1-100 alphanumeric employee code; unique (case-insensitive). Half of app login.';

COMMENT ON COLUMN public.driver_intakes.employee_id IS
  'Mandatory 1-100 alphanumeric employee code; unique among live intakes (case-insensitive).';

CREATE OR REPLACE FUNCTION public.driver_app_lookup_by_passcode(p_driver_code text, p_passcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_driver record;
  v_code text;
  v_audit_id uuid;
BEGIN
  IF p_driver_code IS NULL OR p_passcode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  v_code := btrim(p_driver_code);

  SELECT id, status, driver_code, archived_at, is_blocked, blocked_reason
  INTO v_driver
  FROM public.drivers
  WHERE app_passcode = p_passcode
    AND (lower(employee_id) = lower(v_code) OR driver_code = v_code)
  LIMIT 1;

  IF v_driver.id IS NULL THEN
    SELECT d.id INTO v_audit_id
    FROM public.drivers d
    WHERE lower(d.employee_id) = lower(v_code) OR d.driver_code = v_code
    LIMIT 1;

    PERFORM public.log_driver_operation(
      v_audit_id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'invalid_credentials', 'driver', v_audit_id,
      jsonb_build_object('driver_code_tried', v_code)
    );

    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_driver.archived_at IS NOT NULL THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_archived', 'driver', v_driver.id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_archived');
  END IF;

  IF v_driver.is_blocked THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_blocked', 'driver', v_driver.id,
      jsonb_build_object('reason', nullif(btrim(v_driver.blocked_reason), ''))
    );
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'driver_blocked',
      'reason', nullif(btrim(v_driver.blocked_reason), '')
    );
  END IF;

  IF v_driver.status = 'suspended'::public.driver_status THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_suspended', 'driver', v_driver.id, '{}'::jsonb
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_suspended');
  END IF;

  IF v_driver.status <> 'active'::public.driver_status THEN
    PERFORM public.log_driver_operation(
      v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
      false, 'driver_not_active', 'driver', v_driver.id,
      jsonb_build_object('status', v_driver.status::text)
    );
    RETURN jsonb_build_object('ok', false, 'error', 'driver_not_active');
  END IF;

  PERFORM public.log_driver_operation(
    v_driver.id, 'auth', 'auth.passcode_lookup', 'rpc', 'driver_app_lookup_by_passcode',
    true, NULL, 'driver', v_driver.id, '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_driver.id,
    'driver_code', v_driver.driver_code
  );
END;
$function$;
