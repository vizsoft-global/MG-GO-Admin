-- Reconcile the staff RLS objects that existed on the original (testing)
-- project but were never captured in migrations, so a clean `db push` (the
-- production project) ended up missing them.
--
-- Without these, an authenticated staff user cannot SELECT/INSERT/UPDATE their
-- own profile row, so syncAdminProfile() fails its profiles upsert and admin
-- login returns "Invalid email or password".
--
-- Idempotent: safe to re-run on testing (existing objects are recreated).

-- is_staff(): true when the current user's profile role is 'staff'.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.role = 'staff'::public.app_role FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$function$;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_staff ON public.profiles;
CREATE POLICY profiles_update_staff ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS profiles_select_own_or_staff ON public.profiles;
CREATE POLICY profiles_select_own_or_staff ON public.profiles
  FOR SELECT TO authenticated
  USING ((id = auth.uid()) OR public.is_staff());
