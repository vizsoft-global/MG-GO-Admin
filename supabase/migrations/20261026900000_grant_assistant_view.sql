-- Launch grant: assistant.view only for roles that already hold all three
-- read modules the tools wrap. Super admin still bypasses. No write tools.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'assistant.view'
FROM public.admin_roles r
WHERE EXISTS (
  SELECT 1 FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_slug = 'performance.view'
)
AND EXISTS (
  SELECT 1 FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_slug = 'earnings.view'
)
AND EXISTS (
  SELECT 1 FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_slug = 'deliveries.view'
)
AND NOT EXISTS (
  SELECT 1 FROM public.admin_role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_slug = 'assistant.view'
);
