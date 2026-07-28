-- Driver codes: exactly 5 digits, sequence from 10001 through 99999.

ALTER TABLE public.driver_intakes
  DROP CONSTRAINT IF EXISTS driver_intakes_driver_code_format_chk;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_driver_code_format_chk;

DO $$
DECLARE
  r record;
  v_num bigint := 10000;
BEGIN
  FOR r IN
    SELECT id FROM public.driver_intakes ORDER BY created_at ASC
  LOOP
    v_num := v_num + 1;
    IF v_num > 99999 THEN
      RAISE EXCEPTION 'driver_code_capacity_exceeded';
    END IF;
    UPDATE public.driver_intakes
    SET driver_code = lpad(v_num::text, 5, '0'),
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
    IF v_num > 99999 THEN
      RAISE EXCEPTION 'driver_code_capacity_exceeded';
    END IF;
    UPDATE public.drivers
    SET driver_code = lpad(v_num::text, 5, '0'),
        updated_at = now()
    WHERE id = r.id;
  END LOOP;

  PERFORM setval(
    'public.driver_code_seq',
    GREATEST(v_num + 1, 10001),
    false
  );
END;
$$;

ALTER TABLE public.driver_intakes
  ADD CONSTRAINT driver_intakes_driver_code_format_chk
  CHECK (driver_code ~ '^[0-9]{5}$');

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_driver_code_format_chk
  CHECK (driver_code ~ '^[0-9]{5}$');

CREATE OR REPLACE FUNCTION public.allocate_driver_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('public.driver_code_seq');

  IF v_num > 99999 THEN
    RAISE EXCEPTION 'driver_code_capacity_exceeded';
  END IF;

  RETURN lpad(v_num::text, 5, '0');
END;
$$;

COMMENT ON FUNCTION public.allocate_driver_code() IS
  'Returns the next 5-digit driver code (10001–99999) from driver_code_seq.';
