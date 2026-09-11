-- Fleet default pin: Assets catalog is in MENU_REGISTRY. Roles that already
-- see Vehicles must be able to see /assets, or relocateFleetItems cannot paint it.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'assets.view'
FROM public.admin_roles r
WHERE EXISTS (
  SELECT 1
  FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_slug = 'vehicles.view'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_slug = 'assets.view'
);
