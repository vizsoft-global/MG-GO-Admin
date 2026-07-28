-- Global numeric driver codes (100001+) via sequence; soft-archive without code reuse.

CREATE SEQUENCE IF NOT EXISTS public.driver_code_seq
  AS bigint
  START WITH 100001
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE OR REPLACE FUNCTION public.allocate_driver_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('public.driver_code_seq');
  RETURN v_num::text;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_driver_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_driver_code() TO authenticated, service_role;

ALTER TABLE public.driver_intakes
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Backfill existing rows before adding format constraints.
DO $$
DECLARE
  r record;
  v_num bigint := 100000;
BEGIN
  FOR r IN
    SELECT id FROM public.driver_intakes ORDER BY created_at ASC
  LOOP
    v_num := v_num + 1;
    UPDATE public.driver_intakes
    SET driver_code = v_num::text,
        updated_at = now()
    WHERE id = r.id;
  END LOOP;

  UPDATE public.drivers d
  SET driver_code = i.driver_code,
      updated_at = now()
  FROM public.driver_intakes i
  WHERE i.linked_profile_id = d.id;

  FOR r IN
    SELECT d.id
    FROM public.drivers d
    LEFT JOIN public.driver_intakes i ON i.linked_profile_id = d.id
    WHERE i.id IS NULL
    ORDER BY d.created_at ASC
  LOOP
    v_num := v_num + 1;
    UPDATE public.drivers
    SET driver_code = v_num::text,
        updated_at = now()
    WHERE id = r.id;
  END LOOP;

  UPDATE public.driver_intakes
  SET archived_at = COALESCE(archived_at, updated_at)
  WHERE status = 'cancelled'::public.driver_intake_status;

  PERFORM setval(
    'public.driver_code_seq',
    GREATEST(v_num + 1, 100001),
    false
  );
END;
$$;

CREATE INDEX IF NOT EXISTS driver_intakes_not_archived_idx
  ON public.driver_intakes (created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS drivers_not_archived_idx
  ON public.drivers (created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_driver_code_format_chk;

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_driver_code_format_chk
  CHECK (driver_code ~ '^[0-9]{6,}$');

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_driver_code_format_chk;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_driver_code_format_chk
  CHECK (driver_code ~ '^[0-9]{6,}$');

CREATE OR REPLACE FUNCTION public.driver_intakes_assign_code_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.driver_code IS NULL OR btrim(NEW.driver_code) = '' THEN
    NEW.driver_code := public.allocate_driver_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_intakes_assign_code_on_insert_trg ON public.driver_intakes;
CREATE TRIGGER driver_intakes_assign_code_on_insert_trg
  BEFORE INSERT ON public.driver_intakes
  FOR EACH ROW EXECUTE FUNCTION public.driver_intakes_assign_code_on_insert();

CREATE OR REPLACE FUNCTION public.archive_driver_intake(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked uuid;
BEGIN
  IF NOT public.is_admin_panel_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT linked_profile_id INTO v_linked
  FROM public.driver_intakes
  WHERE id = p_intake_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intake_not_found');
  END IF;

  UPDATE public.driver_intakes
  SET
    archived_at = now(),
    status = 'cancelled'::public.driver_intake_status,
    updated_at = now()
  WHERE id = p_intake_id;

  IF v_linked IS NOT NULL THEN
    UPDATE public.drivers
    SET archived_at = now(), updated_at = now()
    WHERE id = v_linked;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_driver_intake(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_driver_intake(uuid) TO authenticated;

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

  SELECT id, status, driver_code
  INTO v_driver
  FROM public.drivers
  WHERE driver_code = v_code
    AND app_passcode = p_passcode
    AND archived_at IS NULL
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
    'driver_code', v_driver.driver_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_or_sync_rider_profile(p_full_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_role public.app_role;
  v_driver_code text;
  v_phone text;
  v_intake record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_phone := nullif(btrim(coalesce(auth.jwt() ->> 'phone', '')), '');

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  IF v_role = 'staff'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  END IF;

  IF v_role IS NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, locale, phone)
    VALUES (
      v_uid,
      nullif(v_email, ''),
      nullif(trim(p_full_name), ''),
      'rider'::public.app_role,
      'en',
      v_phone
    );
  ELSE
    UPDATE public.profiles
    SET
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      email = coalesce(nullif(v_email, ''), email),
      phone = coalesce(v_phone, phone),
      updated_at = now()
    WHERE id = v_uid AND role = 'rider'::public.app_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_uid) THEN
    IF v_phone IS NOT NULL THEN
      SELECT id, driver_code, linked_profile_id, archived_at
      INTO v_intake
      FROM public.driver_intakes
      WHERE phone = v_phone
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_intake.id IS NOT NULL AND v_intake.archived_at IS NULL THEN
      v_driver_code := v_intake.driver_code;
    ELSE
      v_driver_code := public.allocate_driver_code();
    END IF;

    INSERT INTO public.drivers (id, driver_code, status, is_on_duty)
    VALUES (v_uid, v_driver_code, 'pending'::public.driver_status, false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'driver_code', (
    SELECT driver_code FROM public.drivers WHERE id = v_uid
  ));
END;
$$;

COMMENT ON COLUMN public.driver_intakes.archived_at IS
  'Soft-delete timestamp; driver_code is never reused after archive.';
COMMENT ON COLUMN public.drivers.archived_at IS
  'Soft-delete timestamp; archived drivers cannot sign in to the mobile app.';
