-- Driver app: register/sync rider profile + narrow RLS for riders

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
  v_seq bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  IF v_role = 'staff'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  END IF;

  IF v_role IS NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, locale)
    VALUES (
      v_uid,
      nullif(v_email, ''),
      nullif(trim(p_full_name), ''),
      'rider'::public.app_role,
      'en'
    );
  ELSE
    UPDATE public.profiles
    SET
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      email = coalesce(nullif(v_email, ''), email),
      updated_at = now()
    WHERE id = v_uid AND role = 'rider'::public.app_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = v_uid) THEN
    SELECT coalesce(max(nullif(regexp_replace(driver_code, '\D', '', 'g'), '')::bigint), 0) + 1
    INTO v_seq
    FROM public.drivers
    WHERE driver_code ~ '^DR-[0-9]+$';

    v_driver_code := 'DR-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.drivers (id, driver_code, status, is_on_duty)
    VALUES (v_uid, v_driver_code, 'pending'::public.driver_status, false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'driver_code', (
    SELECT driver_code FROM public.drivers WHERE id = v_uid
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.register_or_sync_rider_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_or_sync_rider_profile(text) TO authenticated;

-- Rider can read/update own profile
DROP POLICY IF EXISTS rider_own_profile_select ON public.profiles;
CREATE POLICY rider_own_profile_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() AND role = 'rider'::public.app_role);

DROP POLICY IF EXISTS rider_own_profile_update ON public.profiles;
CREATE POLICY rider_own_profile_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND role = 'rider'::public.app_role)
  WITH CHECK (id = auth.uid() AND role = 'rider'::public.app_role);

-- Rider can read/update own driver row
DROP POLICY IF EXISTS rider_own_driver_select ON public.drivers;
CREATE POLICY rider_own_driver_select ON public.drivers
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS rider_own_driver_update ON public.drivers;
CREATE POLICY rider_own_driver_update ON public.drivers
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
