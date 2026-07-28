-- Notification governance permissions and default role grants.

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('notifications.approve', 'Approve notifications', 'notifications'),
  ('notifications.send', 'Send notifications', 'notifications'),
  ('notifications.export', 'Export notification reports', 'notifications')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

-- Administrators and super admins get full notification governance by default.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
JOIN public.admin_permissions p
  ON p.slug IN ('notifications.approve', 'notifications.send', 'notifications.export')
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;

-- Operators can export reports but cannot approve/send high-risk campaigns.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
JOIN public.admin_permissions p
  ON p.slug = 'notifications.export'
WHERE r.slug = 'operator'
ON CONFLICT DO NOTHING;
