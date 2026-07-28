-- Auto-create a pending staff profile when an admin signs up via email/password.
--
-- Why: production has email confirmation enabled, so supabase.auth.signUp()
-- returns NO session. The signup server action's profiles upsert then ran as
-- the anon role and was blocked by RLS (profiles_insert_own is TO authenticated
-- with id = auth.uid()), so signup failed with "Could not create account" even
-- though the confirmation email was sent. This trigger creates the profile row
-- with a SECURITY DEFINER function (bypasses RLS, needs no session) so the row
-- exists before email confirmation. syncAdminProfile() then enriches it in the
-- /auth/callback after the user confirms.
--
-- Scoped to admin signups only: the admin signup action stamps
-- raw_user_meta_data.signup_source = 'admin_panel'. Rider OTP self-signup and
-- admin-created driver auth users (which call register_or_sync_rider_profile /
-- admin_approve_driver) are intentionally NOT touched, so role='rider' flows
-- are preserved.

CREATE OR REPLACE FUNCTION public.handle_new_admin_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.raw_user_meta_data ->> 'signup_source', '') <> 'admin_panel' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, locale, approval_status, updated_at)
  VALUES (
    NEW.id,
    lower(NEW.email),
    nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
    'staff'::public.app_role,
    coalesce(nullif(NEW.raw_user_meta_data ->> 'locale', ''), 'en'),
    'pending'::public.admin_approval_status,
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_admin_signup();
