-- Sync all permission-catalog slugs into admin_permissions (fixes drift e.g. partners, restaurants)

INSERT INTO public.admin_permissions (slug, label, category) VALUES
  ('dashboard.view', 'View dashboard', 'dashboard'),
  ('drivers.view', 'View drivers', 'drivers'),
  ('drivers.manage', 'Manage drivers', 'drivers'),
  ('partners.view', 'View partners', 'partners'),
  ('partners.manage', 'Manage partners', 'partners'),
  ('restaurants.view', 'View restaurants', 'restaurants'),
  ('restaurants.manage', 'Manage restaurants', 'restaurants'),
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
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category;
