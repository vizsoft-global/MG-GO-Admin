-- App Page Registry: bridge table mapping every feature between admin panel and driver app
-- Documents tables, columns, logic flows, permissions, and status flows for each page/module

CREATE TABLE IF NOT EXISTS public.app_page_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Page identity
  page_key text NOT NULL UNIQUE,
  page_title text NOT NULL,
  description text,

  -- Which platform owns this page
  platform text NOT NULL CHECK (platform IN ('admin', 'driver_app', 'both')),

  -- Admin panel details
  admin_route text,
  admin_permission text,
  admin_sidebar_id text,

  -- Driver app details
  driver_route text,
  driver_bottom_nav text,

  -- Database tables this page reads/writes
  tables_read text[] NOT NULL DEFAULT '{}',
  tables_write text[] NOT NULL DEFAULT '{}',

  -- Key columns used by this page
  key_columns jsonb NOT NULL DEFAULT '{}',

  -- Business logic description
  logic_summary text,

  -- Status flow (e.g. pending -> verified -> rejected)
  status_flow jsonb,

  -- Realtime channels used
  realtime_channels text[] NOT NULL DEFAULT '{}',

  -- Storage buckets used
  storage_buckets text[] NOT NULL DEFAULT '{}',

  -- RLS notes for driver app
  rls_notes text,

  -- Sort order for display
  sort_order int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_page_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_read_page_registry ON public.app_page_registry;
CREATE POLICY staff_read_page_registry ON public.app_page_registry
  FOR SELECT USING (public.is_admin_panel_user());

COMMENT ON TABLE public.app_page_registry IS
  'Bridge reference mapping every feature/page between admin panel and driver app — tables, logic, permissions, and flows';

-- Seed the registry with all pages/modules

INSERT INTO public.app_page_registry
  (page_key, page_title, description, platform, admin_route, admin_permission, admin_sidebar_id, driver_route, driver_bottom_nav, tables_read, tables_write, key_columns, logic_summary, status_flow, realtime_channels, storage_buckets, rls_notes, sort_order)
VALUES

-- 1. Authentication
('auth_login', 'Login', 'User authentication entry point', 'both',
 '/login', NULL, NULL,
 '/login', NULL,
 ARRAY['profiles', 'app_settings'], ARRAY['auth.users'],
 '{"admin": {"method": "email+password", "table": "profiles", "role_check": "role=staff"}, "driver": {"method": "phone+OTP", "table": "profiles", "role_check": "role=rider"}}'::jsonb,
 'Admin: email login → check role=staff, approval_status=approved, admin_role_id set. Driver: phone OTP → link_driver_by_phone() creates profile+driver row if intake exists.',
 NULL, ARRAY[]::text[], ARRAY[]::text[],
 'Driver can only read own profile row', 1),

-- 2. Dashboard / Home
('dashboard', 'Dashboard / Home', 'Overview with KPIs and quick actions', 'both',
 '/dashboard', 'dashboard.view', 'dashboard',
 '/', 'home',
 ARRAY['deliveries', 'drivers', 'driver_sessions', 'driver_earnings_daily', 'attendance_logs', 'requests'], ARRAY['driver_sessions'],
 '{"kpis": ["total_deliveries_today", "active_riders", "on_duty_count", "pending_fuel_claims", "active_zones", "suspended_count"], "driver_kpis": ["weekly_deliveries", "weekly_earnings", "bumper_bonus", "duty_status"]}'::jsonb,
 'Admin: aggregated fleet KPIs across all drivers. Driver: personal KPIs (weekly deliveries, earnings, bonus), online/offline toggle updates driver_sessions.',
 NULL,
 ARRAY['driver_sessions'], ARRAY[]::text[],
 'Driver reads own sessions and earnings only', 2),

-- 3. Drivers / Profile
('drivers', 'Drivers / Profile', 'Driver workforce management and profile', 'both',
 '/drivers', 'drivers.view', 'drivers',
 '/profile', 'profile',
 ARRAY['driver_intakes', 'drivers', 'profiles', 'partners', 'zones', 'vehicles', 'driver_documents', 'driver_assets', 'deliveries'], ARRAY['driver_intakes', 'drivers', 'profiles'],
 '{"list_columns": ["driver_code", "full_name", "phone", "partner_name", "zone_name", "account_status", "is_on_duty", "today_deliveries"], "detail_columns": ["civil_id", "email", "avatar_url", "vehicle_label", "assets_issued", "restaurant_ids", "joined_at"]}'::jsonb,
 'Admin: CRUD driver intakes, manage workflow (draft→pending→approved), view all drivers with filters. Driver: read-only profile, personal docs, assigned vehicle and zone info.',
 '{"workflow_status": ["draft", "pending", "approved"], "account_status": ["active", "suspended", "pending"]}'::jsonb,
 ARRAY[]::text[],
 ARRAY['drivers/intakes/{intake_id}/', 'drivers/{driver_id}/'],
 'Driver reads own profile, documents, assets. Admin reads/writes all via is_admin_panel_user()', 3),

-- 4. Deliveries
('deliveries', 'Deliveries', 'Delivery logging, verification, and tracking', 'both',
 '/deliveries', 'deliveries.view', 'deliveries',
 '/deliveries', 'deliveries',
 ARRAY['deliveries', 'drivers', 'partners', 'zones', 'restaurants'], ARRAY['deliveries'],
 '{"columns": ["driver_id", "partner_id", "zone_id", "restaurant_id", "external_order_id", "order_proof_url", "status", "rejection_reason", "delivered_at"], "filters": ["status", "zone_id", "partner_id", "date_range"]}'::jsonb,
 'Driver submits delivery (status=pending) with order ID + proof photo. Admin verifies (verified) or rejects (rejected + reason). On verify, trigger recalculate_driver_earnings() updates driver_earnings_daily.',
 '{"status": ["pending", "verified", "rejected"], "trigger": "ON UPDATE status=verified → recalculate_driver_earnings(driver_id, earn_date)"}'::jsonb,
 ARRAY[]::text[],
 ARRAY['delivery-proofs'],
 'Driver: INSERT own deliveries, SELECT where driver_id=auth.uid(). Admin: SELECT/UPDATE all.', 4),

-- 5. Zones
('zones', 'Zones', 'Geographic delivery zones with geofencing', 'both',
 '/zones', 'zones.view', 'zones',
 NULL, NULL,
 ARRAY['zones', 'drivers'], ARRAY['zones', 'attendance_logs'],
 '{"columns": ["name", "code", "zone_type", "geometry", "color", "driver_count"], "geometry_types": ["polygon", "circle"], "geojson": "Feature with Polygon or Point+radiusMeters"}'::jsonb,
 'Admin: CRUD zones with map drawing (polygon/circle). Driver app: reads assigned zone geometry for geofence check. If driver outside zone → countdown banner, attendance_logs.zone_compliance=outside.',
 NULL,
 ARRAY[]::text[], ARRAY[]::text[],
 'Driver reads zones via drivers.zone_id FK. Admin manages all zones.', 5),

-- 6. Vehicles
('vehicles', 'Vehicles', 'Fleet vehicle management', 'both',
 '/vehicles', 'vehicles.view', 'vehicles',
 '/vehicle', 'vehicle',
 ARRAY['vehicles', 'drivers'], ARRAY['vehicles'],
 '{"columns": ["bike_id", "reg_number", "model", "status", "current_driver_id", "last_service_date"]}'::jsonb,
 'Admin: manage fleet vehicles, assign/unassign to drivers. Driver: view assigned vehicle info (read-only).',
 '{"status": ["active", "maintenance", "retired"]}'::jsonb,
 ARRAY[]::text[], ARRAY[]::text[],
 'Driver reads vehicle where current_driver_id=auth.uid()', 6),

-- 7. Attendance
('attendance', 'Attendance', 'Driver check-in/out and zone compliance', 'both',
 '/attendance', 'attendance.view', 'attendance',
 NULL, NULL,
 ARRAY['attendance_logs', 'drivers', 'driver_sessions', 'zones'], ARRAY['attendance_logs', 'driver_sessions'],
 '{"columns": ["driver_id", "log_date", "status", "check_in_at", "check_out_at", "zone_compliance"], "statuses": ["present", "late", "absent", "on_leave"]}'::jsonb,
 'Auto-generated on driver check-in via geofence. Admin views attendance records. Driver app updates driver_sessions on duty toggle, writes attendance_logs.zone_compliance.',
 '{"status": ["present", "late", "absent", "on_leave"], "zone_compliance": ["inside", "outside"]}'::jsonb,
 ARRAY['driver_sessions'], ARRAY[]::text[],
 'Driver writes own attendance and sessions', 7),

-- 8. Requests (Loan, Leave, Fuel, Complaint)
('requests', 'Requests', 'HR requests — loan, leave, fuel expense, complaints', 'both',
 '/requests', 'requests.view', 'requests',
 '/requests', NULL,
 ARRAY['requests', 'loan_terms', 'drivers'], ARRAY['requests', 'loan_terms'],
 '{"columns": ["request_code", "request_type", "status", "amount_kwd", "start_date", "end_date", "details", "attachment_url", "decision_reason"], "types": ["loan", "leave", "fuel", "complaint", "document"]}'::jsonb,
 'Driver submits request (pending). Admin approves/rejects with optional reason. For loans: admin sets loan_terms on approval. For fuel: approved → reimbursed via payroll.',
 '{"status": ["pending", "approved", "rejected"], "fuel_extended": ["pending", "approved", "reimbursed"]}'::jsonb,
 ARRAY[]::text[],
 ARRAY['fuel-receipts'],
 'Driver: INSERT own requests, SELECT where driver_id=auth.uid(). Admin: SELECT/UPDATE all.', 8),

-- 9. Wrong Actions
('wrong_actions', 'Wrong Actions', 'Driver violations and compliance issues', 'both',
 '/wrong-actions', 'wrong_actions.view', 'wrong-actions',
 '/wrong-actions', NULL,
 ARRAY['wrong_actions', 'drivers'], ARRAY['wrong_actions'],
 '{"columns": ["driver_id", "action_type", "severity", "details", "occurred_at", "penalty_kwd"]}'::jsonb,
 'Admin creates wrong action records against drivers. Driver app shows history (read-only). Severity levels affect earnings deductions.',
 '{"severity": ["low", "medium", "high", "critical"]}'::jsonb,
 ARRAY[]::text[], ARRAY[]::text[],
 'Driver reads own wrong_actions where driver_id=auth.uid()', 9),

-- 10. Earnings & Incentives
('earnings', 'Earnings & Incentives', 'Daily earnings tracking and incentive rules', 'both',
 '/earnings', 'earnings.view', 'earnings',
 '/earnings', 'earnings',
 ARRAY['driver_earnings_daily', 'delivery_rules', 'incentive_rules', 'deliveries', 'offers'], ARRAY['driver_earnings_daily'],
 '{"daily_columns": ["driver_id", "earn_date", "deliveries_count", "base_kwd", "incentive_kwd", "deductions_kwd", "net_kwd"], "rule_columns": ["scope", "zone_id", "partner_id", "restaurant_id", "target_deliveries", "reward_kwd", "period"]}'::jsonb,
 'Calculated automatically: on delivery verify → recalculate_driver_earnings(). delivery_rules filter which deliveries count. incentive_rules define targets and bonuses (daily/weekly/monthly, stackable). Driver sees earnings breakdown.',
 NULL,
 ARRAY[]::text[], ARRAY[]::text[],
 'Driver reads own driver_earnings_daily where driver_id=auth.uid()', 10),

-- 11. Delivery Rules
('delivery_rules', 'Delivery Rules', 'Rules for which deliveries count toward incentives', 'admin',
 '/delivery-rules', 'earnings.view', 'delivery-rules',
 NULL, NULL,
 ARRAY['delivery_rules', 'zones', 'partners', 'restaurants'], ARRAY['delivery_rules'],
 '{"columns": ["name", "scope", "zone_id", "partner_id", "restaurant_id", "is_active"]}'::jsonb,
 'Admin-only. Defines which verified deliveries count toward incentive calculations. Scoped to zone, partner, or restaurant. If no active rules, all verified deliveries count.',
 NULL, ARRAY[]::text[], ARRAY[]::text[],
 'Admin only — no driver access', 11),

-- 12. Incentive Rules
('incentive_rules', 'Incentive Rules', 'Target-based bonus rules for drivers', 'admin',
 '/incentive-rules', 'earnings.manage', 'incentive-rules',
 NULL, NULL,
 ARRAY['incentive_rules', 'zones', 'partners', 'restaurants'], ARRAY['incentive_rules'],
 '{"columns": ["name", "period", "target_deliveries", "reward_kwd", "scope", "zone_id", "partner_id", "restaurant_id", "is_active", "cumulative"]}'::jsonb,
 'Admin-only. Period: daily/weekly/monthly. Matching rules stack (sum of rewards). Cumulative flag for tiered targets. Kuwait calendar for period boundaries.',
 NULL, ARRAY[]::text[], ARRAY[]::text[],
 'Admin only — driver sees effect via driver_earnings_daily', 12),

-- 13. Earnings Calculation
('earnings_calculation', 'Earnings Calculation', 'Manual recalculation of driver earnings', 'admin',
 '/earnings-calculation', 'earnings.manage', 'earnings-calculation',
 NULL, NULL,
 ARRAY['driver_earnings_daily', 'deliveries', 'delivery_rules', 'incentive_rules'], ARRAY['driver_earnings_daily'],
 '{}'::jsonb,
 'Admin triggers manual recalculation of earnings for a driver or date range via RPC recalculate_driver_earnings().',
 NULL, ARRAY[]::text[], ARRAY[]::text[],
 'Admin only', 13),

-- 14. Notifications
('notifications', 'Notifications', 'Push notifications and hygiene tasks', 'both',
 '/notifications', 'notifications.view', 'notifications',
 '/notifications', NULL,
 ARRAY['notifications', 'hygiene_tasks', 'hygiene_submissions'], ARRAY['notifications', 'hygiene_submissions'],
 '{"notification_payload": ["title", "body", "on_click_action", "link_url", "hygiene_task_id"], "deep_links": ["home", "deliveries", "vehicle", "profile", "hygiene_task", "custom_link"]}'::jsonb,
 'Admin sends notifications via table insert → triggers push to driver via FCM/APNs. Hygiene tasks: admin creates → push → driver submits photo → admin reviews.',
 '{"hygiene": ["created", "pending_submission", "submitted", "completed", "rejected"]}'::jsonb,
 ARRAY['notifications:driver:{driver_id}'],
 ARRAY['hygiene-photos'],
 'Driver reads own notifications. Driver writes hygiene_submissions where driver_id=auth.uid().', 14),

-- 15. Support / Chat
('support', 'Support & Chat', 'Control Tower chat, SOS, and appointments', 'both',
 '/support', 'support.view', 'support',
 '/support', NULL,
 ARRAY['support_threads', 'support_messages', 'support_tickets', 'appointment_slots', 'appointments'], ARRAY['support_threads', 'support_messages', 'support_tickets', 'appointments'],
 '{"chat": ["thread_id", "sender_id", "body", "attachment_url"], "sos": ["driver_id", "location", "description"], "appointments": ["slot_id", "driver_id", "status"]}'::jsonb,
 'One chat thread per driver with Control Tower (realtime). SOS creates urgent support ticket. Appointments: driver books from available slots.',
 '{"ticket_status": ["open", "in_progress", "resolved", "closed"], "appointment_status": ["booked", "completed", "cancelled"]}'::jsonb,
 ARRAY['support:thread:{thread_id}'],
 ARRAY['support-attachments'],
 'Driver reads/writes own threads, tickets, appointments where driver_id=auth.uid()', 15),

-- 16. Partners
('partners', 'Partners', 'Delivery partner companies (Talabat, Door Dash, Uber Eats)', 'admin',
 '/partners', 'partners.view', 'partners',
 NULL, NULL,
 ARRAY['partners', 'drivers'], ARRAY['partners'],
 '{"columns": ["name", "slug", "description", "logo_url", "driver_count"]}'::jsonb,
 'Admin manages partner companies. Drivers are assigned to partners. Partner logos stored in R2.',
 NULL, ARRAY[]::text[],
 ARRAY['partners/{partner_id}/logo.{ext}'],
 'Driver reads partner name/logo via drivers.partner_id FK', 16),

-- 17. Restaurants
('restaurants', 'Restaurants', 'Restaurant/merchant directory linked to partners', 'admin',
 '/restaurants', 'restaurants.view', 'restaurants',
 NULL, NULL,
 ARRAY['restaurants', 'partners', 'driver_intake_restaurants'], ARRAY['restaurants'],
 '{"columns": ["name", "partner_id", "external_merchant_id", "status", "latitude", "longitude"]}'::jsonb,
 'Admin manages restaurant directory. Restaurants linked to partners. Drivers can be assigned specific restaurants. Used in delivery rules and incentive scoping.',
 '{"status": ["draft", "published", "archived"]}'::jsonb,
 ARRAY[]::text[], ARRAY[]::text[],
 'Driver may read restaurants assigned to them', 17),

-- 18. Settings
('settings', 'Settings', 'Admin panel configuration — branding, roles, maintenance, menu editor, languages', 'admin',
 '/settings', 'settings.view', 'settings',
 NULL, NULL,
 ARRAY['app_settings', 'admin_roles', 'admin_permissions', 'admin_role_permissions', 'menu_configs', 'locales'], ARRAY['app_settings', 'admin_roles', 'admin_role_permissions', 'menu_configs', 'locales'],
 '{"sub_pages": ["/settings/branding", "/settings/roles", "/settings/maintenance", "/settings/menu-editor", "/settings/languages", "/settings/storage", "/settings/access-requests"]}'::jsonb,
 'Admin-only configuration. Branding (name, logo, font), RBAC roles/permissions, maintenance mode toggle, sidebar menu editor per role, locale management.',
 NULL, ARRAY[]::text[],
 ARRAY['branding'],
 'Admin only — no driver access', 18)

ON CONFLICT (page_key) DO NOTHING;
