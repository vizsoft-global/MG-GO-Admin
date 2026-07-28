-- RBAC, sign-up approval, super-admin claim, maintenance mode

DO $$ BEGIN
  CREATE TYPE public.admin_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- App settings extensions
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_admin_claimed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_admin_user_id uuid REFERENCES auth.users(id);

-- RBAC tables
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  slug text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  permission_slug text NOT NULL REFERENCES public.admin_permissions(slug) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_slug)
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_role_id uuid REFERENCES public.admin_roles(id),
  ADD COLUMN IF NOT EXISTS approval_status public.admin_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id);

-- Seed permissions
INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('dashboard.view', 'View dashboard', 'dashboard'),
  ('drivers.view', 'View drivers', 'drivers'),
  ('drivers.manage', 'Manage drivers', 'drivers'),
  ('vehicles.view', 'View vehicles', 'vehicles'),
  ('vehicles.manage', 'Manage vehicles', 'vehicles'),
  ('deliveries.view', 'View deliveries', 'deliveries'),
  ('deliveries.manage', 'Manage deliveries', 'deliveries'),
  ('zones.view', 'View zones', 'zones'),
  ('zones.manage', 'Manage zones', 'zones'),
  ('attendance.view', 'View attendance', 'attendance'),
  ('requests.view', 'View requests', 'requests'),
  ('requests.manage', 'Manage requests', 'requests'),
  ('wrong_actions.view', 'View wrong actions', 'compliance'),
  ('wrong_actions.manage', 'Manage wrong actions', 'compliance'),
  ('earnings.view', 'View earnings', 'earnings'),
  ('earnings.manage', 'Manage earnings', 'earnings'),
  ('notifications.view', 'View notifications', 'notifications'),
  ('notifications.manage', 'Manage notifications', 'notifications'),
  ('support.view', 'View support', 'support'),
  ('support.manage', 'Manage support', 'support'),
  ('settings.view', 'View settings', 'settings'),
  ('settings.manage', 'Manage settings', 'settings'),
  ('users.manage', 'Manage users and approvals', 'admin'),
  ('roles.manage', 'Manage roles and permissions', 'admin')
ON CONFLICT (slug) DO NOTHING;

-- Seed roles
INSERT INTO public.admin_roles (slug, name, is_system, is_super_admin) VALUES
  ('super_admin', 'Super Admin', true, true),
  ('administrator', 'Administrator', true, false),
  ('operator', 'Operator', true, false)
ON CONFLICT (slug) DO NOTHING;

-- Super admin: all permissions
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;

-- Administrator: all except roles.manage
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'administrator' AND p.slug != 'roles.manage'
ON CONFLICT DO NOTHING;

-- Operator: view all + limited manage
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'operator'
  AND (
    p.slug LIKE '%.view'
    OR p.slug IN ('requests.manage', 'support.manage', 'settings.view')
  )
ON CONFLICT DO NOTHING;

-- Migrate existing staff to approved administrator
UPDATE public.profiles p
SET
  admin_role_id = (SELECT id FROM public.admin_roles WHERE slug = 'administrator' LIMIT 1),
  approval_status = 'approved'
WHERE p.role = 'staff'::public.app_role
  AND p.archived_at IS NULL
  AND p.admin_role_id IS NULL;

-- Promote chethan / existing super admin seed
DO $$
DECLARE
  v_super_id uuid;
  v_chethan_id uuid;
BEGIN
  SELECT id INTO v_super_id FROM public.admin_roles WHERE slug = 'super_admin' LIMIT 1;

  SELECT id INTO v_chethan_id FROM public.profiles
  WHERE lower(email) = 'chethan@vizsoft.in'
  LIMIT 1;

  IF v_chethan_id IS NOT NULL AND v_super_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      admin_role_id = v_super_id,
      approval_status = 'approved',
      role = 'staff'::public.app_role
    WHERE id = v_chethan_id;

    UPDATE public.app_settings
    SET super_admin_claimed = true, super_admin_user_id = v_chethan_id
    WHERE id = 1;
  END IF;
END $$;

-- claim_super_admin (one-time)
CREATE OR REPLACE FUNCTION public.claim_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_role_id uuid;
BEGIN
  IF (SELECT super_admin_claimed FROM public.app_settings WHERE id = 1) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_super_role_id FROM public.admin_roles WHERE slug = 'super_admin' LIMIT 1;
  IF v_super_role_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET
    admin_role_id = v_super_role_id,
    approval_status = 'approved',
    role = 'staff'::public.app_role,
    updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.admin_allowlist (email, role)
  SELECT lower(email), 'staff'::public.app_role
  FROM public.profiles WHERE id = p_user_id
  ON CONFLICT (email) DO NOTHING;

  UPDATE public.app_settings
  SET super_admin_claimed = true, super_admin_user_id = p_user_id, updated_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

-- is_super_admin helper
CREATE OR REPLACE FUNCTION public.is_super_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_roles r ON r.id = p.admin_role_id
    WHERE p.id = auth.uid()
      AND r.is_super_admin = true
      AND p.approval_status = 'approved'
      AND p.archived_at IS NULL
  );
$$;

-- Update is_admin_panel_user for RBAC + approval
CREATE OR REPLACE FUNCTION public.is_admin_panel_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'staff'::public.app_role
      AND p.archived_at IS NULL
      AND p.approval_status = 'approved'
      AND p.admin_role_id IS NOT NULL
  );
$$;

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_permissions_read ON public.admin_permissions
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

CREATE POLICY admin_roles_read ON public.admin_roles
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

CREATE POLICY admin_role_permissions_read ON public.admin_role_permissions
  FOR SELECT TO authenticated USING (public.is_admin_panel_user());

CREATE POLICY admin_role_permissions_write ON public.admin_role_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

CREATE POLICY admin_roles_insert ON public.admin_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin_user() AND is_system = false);

CREATE POLICY admin_roles_update ON public.admin_roles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

CREATE POLICY admin_roles_delete ON public.admin_roles
  FOR DELETE TO authenticated
  USING (public.is_super_admin_user() AND is_system = false);
