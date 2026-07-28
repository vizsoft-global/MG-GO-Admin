-- The admin_permissions table is a static catalog seeded by migrations,
-- but the admin panel re-syncs it on the Roles & Permissions page via
-- `syncAdminPermissionsFromCatalog`. Without an INSERT/UPDATE policy that
-- upsert silently fails with "new row violates row-level security policy
-- for table 'admin_permissions'", which spams the postgres logs and can
-- block legitimate admin flows from progressing.
--
-- Allow super admins (the only people who can hit the Roles page) to
-- write to the catalog. Read access is unchanged: any admin-panel user
-- can SELECT it (existing `admin_permissions_read` policy).

DROP POLICY IF EXISTS admin_permissions_super_admin_write ON public.admin_permissions;
CREATE POLICY admin_permissions_super_admin_write ON public.admin_permissions
  FOR ALL
  TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

COMMENT ON POLICY admin_permissions_super_admin_write ON public.admin_permissions IS
  'Super admins can upsert the permission catalog (used by the Roles & Permissions page sync).';
