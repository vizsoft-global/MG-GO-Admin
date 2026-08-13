-- ---------------------------------------------------------------------------
-- Driver app activity permissions
--
-- The Activity tab reads driver_operation_events, which is a far wider audit
-- surface than the GPS map: it carries failed login attempts, security events
-- and request payload context. So it gets its own slugs instead of riding on
-- drivers.view, which every operator already has.
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('driver_ops.view', 'View driver app activity', 'drivers'),
  ('driver_ops.export', 'Export driver app activity', 'drivers')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN (
  VALUES
    ('driver_ops.view'),
    ('driver_ops.export')
) AS p(slug)
WHERE r.slug IN ('super_admin', 'administrator')
ON CONFLICT DO NOTHING;
