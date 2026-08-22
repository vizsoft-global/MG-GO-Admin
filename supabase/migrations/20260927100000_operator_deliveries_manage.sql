-- Operator sits on /deliveries all day. Bulk verify hid the checkbox column
-- behind deliveries.manage, so the queue looked broken for that role.
INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, 'deliveries.manage'
FROM public.admin_roles r
WHERE r.slug = 'operator'
ON CONFLICT DO NOTHING;
