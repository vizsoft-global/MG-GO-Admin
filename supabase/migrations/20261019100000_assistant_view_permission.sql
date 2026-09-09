-- Seed assistant.view only. No role grants — launch later grants only to
-- roles that already hold performance.view AND earnings.view AND
-- deliveries.view. Super admin still bypasses. No /assistant route yet.

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('assistant.view', 'View AI staff assistant', 'assistant')
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;
