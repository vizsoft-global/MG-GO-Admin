-- Staff department for the Roles & Permissions per-user access editor.
-- Filter chips: HR / Accounts / Admin / Operations & Fleet.
-- Writes stay on the existing profiles staff policy; the editor action is
-- requireSuperAdmin, matching admin_user_permissions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_department text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_staff_department_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_staff_department_check
  CHECK (
    staff_department IS NULL
    OR staff_department IN ('hr', 'accounts', 'admin', 'operations_fleet')
  );

COMMENT ON COLUMN public.profiles.staff_department IS
  'Optional staff desk for Roles & Permissions filters: hr | accounts | admin | operations_fleet';
