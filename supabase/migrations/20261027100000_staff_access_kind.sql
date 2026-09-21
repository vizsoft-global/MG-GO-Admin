-- Per-user staff access: Manager (full catalog) vs User (ticks).
-- Role matrix becomes a template for new Users; existing staff keep their
-- current role slugs expanded onto admin_user_permissions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_kind text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_access_kind_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_access_kind_check
  CHECK (access_kind IS NULL OR access_kind IN ('manager', 'user'));

COMMENT ON COLUMN public.profiles.access_kind IS
  'manager = full catalog like super admin; user = admin_user_permissions ticks only';

CREATE TABLE IF NOT EXISTS public.admin_user_permissions (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  permission_slug text NOT NULL REFERENCES public.admin_permissions (slug) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_slug)
);

CREATE INDEX IF NOT EXISTS admin_user_permissions_slug_idx
  ON public.admin_user_permissions (permission_slug);

ALTER TABLE public.admin_user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_user_permissions_read ON public.admin_user_permissions;
CREATE POLICY admin_user_permissions_read ON public.admin_user_permissions
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS admin_user_permissions_write ON public.admin_user_permissions;
CREATE POLICY admin_user_permissions_write ON public.admin_user_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin_user())
  WITH CHECK (public.is_super_admin_user());

-- CRUD verbs for every resource that already has *.manage (compat alias stays).
INSERT INTO public.admin_permissions (slug, label, category)
VALUES
  ('drivers.create', 'Create drivers', 'drivers'),
  ('drivers.edit', 'Edit drivers', 'drivers'),
  ('drivers.delete', 'Delete drivers', 'drivers'),
  ('driver_groups.create', 'Create driver groups', 'drivers'),
  ('driver_groups.edit', 'Edit driver groups', 'drivers'),
  ('driver_groups.delete', 'Delete driver groups', 'drivers'),
  ('partners.create', 'Create partners', 'partners'),
  ('partners.edit', 'Edit partners', 'partners'),
  ('partners.delete', 'Delete partners', 'partners'),
  ('restaurants.create', 'Create restaurants', 'restaurants'),
  ('restaurants.edit', 'Edit restaurants', 'restaurants'),
  ('restaurants.delete', 'Delete restaurants', 'restaurants'),
  ('vehicles.create', 'Create vehicles', 'vehicles'),
  ('vehicles.edit', 'Edit vehicles', 'vehicles'),
  ('vehicles.delete', 'Delete vehicles', 'vehicles'),
  ('assets.create', 'Create assets', 'assets'),
  ('assets.edit', 'Edit assets', 'assets'),
  ('assets.delete', 'Delete assets', 'assets'),
  ('deliveries.create', 'Create deliveries', 'deliveries'),
  ('deliveries.edit', 'Edit deliveries', 'deliveries'),
  ('deliveries.delete', 'Delete deliveries', 'deliveries'),
  ('verifications.create', 'Create DPD verifications', 'deliveries'),
  ('verifications.edit', 'Edit DPD verifications', 'deliveries'),
  ('verifications.delete', 'Delete DPD verifications', 'deliveries'),
  ('zones.create', 'Create zones', 'zones'),
  ('zones.edit', 'Edit zones', 'zones'),
  ('zones.delete', 'Delete zones', 'zones'),
  ('attendance.create', 'Create attendance records', 'attendance'),
  ('attendance.edit', 'Edit attendance records', 'attendance'),
  ('attendance.delete', 'Delete attendance records', 'attendance'),
  ('requests.create', 'Create requests', 'requests'),
  ('requests.edit', 'Edit requests', 'requests'),
  ('requests.delete', 'Delete requests', 'requests'),
  ('wrong_actions.create', 'Create wrong actions', 'compliance'),
  ('wrong_actions.edit', 'Edit wrong actions', 'compliance'),
  ('wrong_actions.delete', 'Delete wrong actions', 'compliance'),
  ('documents.create', 'Create document expiry records', 'compliance'),
  ('documents.edit', 'Edit document expiry records', 'compliance'),
  ('documents.delete', 'Delete document expiry records', 'compliance'),
  ('earnings.create', 'Create earnings rules', 'earnings'),
  ('earnings.edit', 'Edit earnings rules', 'earnings'),
  ('earnings.delete', 'Delete earnings rules', 'earnings'),
  ('notifications.create', 'Create notifications', 'notifications'),
  ('notifications.edit', 'Edit notifications', 'notifications'),
  ('notifications.delete', 'Delete notifications', 'notifications'),
  ('support.create', 'Create support threads', 'support'),
  ('support.edit', 'Edit support threads', 'support'),
  ('support.delete', 'Delete support threads', 'support')
ON CONFLICT (slug) DO UPDATE
SET label = EXCLUDED.label,
    category = EXCLUDED.category;

-- Role templates gain CRUD ticks wherever they already had *.manage.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT rp.role_id, replace(rp.permission_slug, '.manage', '') || v.verb
FROM public.admin_role_permissions rp
CROSS JOIN (VALUES ('.create'), ('.edit'), ('.delete')) AS v (verb)
WHERE rp.permission_slug IN (
  'drivers.manage',
  'driver_groups.manage',
  'partners.manage',
  'restaurants.manage',
  'vehicles.manage',
  'assets.manage',
  'deliveries.manage',
  'verifications.manage',
  'zones.manage',
  'attendance.manage',
  'requests.manage',
  'wrong_actions.manage',
  'documents.manage',
  'earnings.manage',
  'notifications.manage',
  'support.manage'
)
ON CONFLICT DO NOTHING;

-- Super-admin staff → Manager. Everyone else with a panel role → User.
UPDATE public.profiles AS p
SET access_kind = 'manager'
FROM public.admin_roles AS r
WHERE p.admin_role_id = r.id
  AND p.role = 'staff'
  AND r.is_super_admin = true
  AND p.access_kind IS NULL;

UPDATE public.profiles AS p
SET access_kind = 'user'
WHERE p.role = 'staff'
  AND p.admin_role_id IS NOT NULL
  AND p.access_kind IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_roles AS r
    WHERE r.id = p.admin_role_id
      AND r.is_super_admin = true
  );

-- Copy non-CRUD-manage role slugs as-is.
INSERT INTO public.admin_user_permissions (user_id, permission_slug)
SELECT p.id, arp.permission_slug
FROM public.profiles AS p
JOIN public.admin_role_permissions AS arp ON arp.role_id = p.admin_role_id
WHERE p.role = 'staff'
  AND p.access_kind = 'user'
  AND arp.permission_slug NOT IN (
    'drivers.manage',
    'driver_groups.manage',
    'partners.manage',
    'restaurants.manage',
    'vehicles.manage',
    'assets.manage',
    'deliveries.manage',
    'verifications.manage',
    'zones.manage',
    'attendance.manage',
    'requests.manage',
    'wrong_actions.manage',
    'documents.manage',
    'earnings.manage',
    'notifications.manage',
    'support.manage'
  )
ON CONFLICT DO NOTHING;

-- Expand CRUD *.manage → create/edit/delete.
INSERT INTO public.admin_user_permissions (user_id, permission_slug)
SELECT p.id, replace(arp.permission_slug, '.manage', '') || v.verb
FROM public.profiles AS p
JOIN public.admin_role_permissions AS arp ON arp.role_id = p.admin_role_id
CROSS JOIN (VALUES ('.create'), ('.edit'), ('.delete')) AS v (verb)
WHERE p.role = 'staff'
  AND p.access_kind = 'user'
  AND arp.permission_slug IN (
    'drivers.manage',
    'driver_groups.manage',
    'partners.manage',
    'restaurants.manage',
    'vehicles.manage',
    'assets.manage',
    'deliveries.manage',
    'verifications.manage',
    'zones.manage',
    'attendance.manage',
    'requests.manage',
    'wrong_actions.manage',
    'documents.manage',
    'earnings.manage',
    'notifications.manage',
    'support.manage'
  )
ON CONFLICT DO NOTHING;
