-- Partners admin: description, RBAC, logo storage

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.partners.description IS 'Short description shown in admin and driver flows';

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('partners.view', 'View partners', 'partners'),
  ('partners.manage', 'Manage partners', 'partners')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'super_admin'
  AND p.slug IN ('partners.view', 'partners.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'administrator'
  AND p.slug IN ('partners.view', 'partners.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_slug)
SELECT r.id, p.slug
FROM public.admin_roles r
CROSS JOIN public.admin_permissions p
WHERE r.slug = 'operator'
  AND p.slug = 'partners.view'
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'partner-logos',
  'partner-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY partner_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'partner-logos');

CREATE POLICY partner_logos_staff_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'partner-logos' AND public.is_admin_panel_user())
  WITH CHECK (bucket_id = 'partner-logos' AND public.is_admin_panel_user());
