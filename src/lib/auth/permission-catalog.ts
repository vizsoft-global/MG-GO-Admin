/**
 * Canonical permission catalog — single source of truth for RBAC.
 *
 * When adding a new admin page:
 * 1. Add view/manage entries here (slug, label, category)
 * 2. Set the same slug on MENU_REGISTRY item `permission`
 * 3. Call requirePermission(locale, slug) on the page
 * 4. Optional: document in app_page_registry migration
 *
 * Opening Roles & Permissions syncs this catalog into admin_permissions.
 */

export type PermissionCatalogEntry = {
  slug: string;
  label: string;
  category: string;
};

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  { slug: "dashboard.view", label: "View dashboard", category: "dashboard" },
  { slug: "drivers.view", label: "View drivers", category: "drivers" },
  { slug: "drivers.manage", label: "Manage drivers", category: "drivers" },
  { slug: "driver_groups.view", label: "View driver groups", category: "drivers" },
  { slug: "driver_groups.manage", label: "Manage driver groups", category: "drivers" },
  { slug: "driver_ops.view", label: "View driver app activity", category: "drivers" },
  {
    slug: "driver_ops.export",
    label: "Export driver app activity",
    category: "drivers",
  },
  {
    slug: "driver_telemetry.view",
    label: "View driver app diagnostics",
    category: "drivers",
  },
  {
    slug: "driver_telemetry.export",
    label: "Export driver app diagnostics",
    category: "drivers",
  },
  { slug: "partners.view", label: "View partners", category: "partners" },
  { slug: "partners.manage", label: "Manage partners", category: "partners" },
  { slug: "restaurants.view", label: "View restaurants", category: "restaurants" },
  { slug: "restaurants.manage", label: "Manage restaurants", category: "restaurants" },
  { slug: "vehicles.view", label: "View vehicles", category: "vehicles" },
  { slug: "vehicles.manage", label: "Manage vehicles", category: "vehicles" },
  { slug: "assets.view", label: "View assets inventory", category: "assets" },
  { slug: "assets.manage", label: "Manage assets inventory", category: "assets" },
  { slug: "deliveries.view", label: "View deliveries", category: "deliveries" },
  { slug: "deliveries.manage", label: "Manage deliveries", category: "deliveries" },
  {
    slug: "verifications.view",
    label: "View DPD verification",
    category: "deliveries",
  },
  {
    slug: "verifications.manage",
    label: "Manage DPD verification",
    category: "deliveries",
  },
  { slug: "zones.view", label: "View zones", category: "zones" },
  { slug: "zones.manage", label: "Manage zones", category: "zones" },
  { slug: "attendance.view", label: "View attendance", category: "attendance" },
  { slug: "attendance.manage", label: "Manage attendance", category: "attendance" },
  {
    slug: "performance.view",
    label: "View performance dashboard",
    category: "performance",
  },
  {
    slug: "performance.export",
    label: "Export performance reports",
    category: "performance",
  },
  {
    slug: "performance.rate",
    label: "Rate drivers as a team",
    category: "performance",
  },
  {
    slug: "performance.manage_teams",
    label: "Manage rating teams and members",
    category: "performance",
  },
  { slug: "requests.view", label: "View requests", category: "requests" },
  { slug: "requests.manage", label: "Manage requests", category: "requests" },
  {
    slug: "requests.approve",
    label: "Approve / decide requests (Approver)",
    category: "requests",
  },
  {
    slug: "visits.view",
    label: "View visit bookings (Head Office)",
    category: "visits",
  },
  {
    slug: "visits.manage_catalog",
    label: "Manage visit slots, branches, departments (Head Office)",
    category: "visits",
  },
  {
    slug: "visits.operate",
    label: "Check-in / reschedule / cancel / change visit status (Operator)",
    category: "visits",
  },
  {
    slug: "wrong_actions.view",
    label: "View wrong actions",
    category: "compliance",
  },
  {
    slug: "wrong_actions.manage",
    label: "Manage wrong actions",
    category: "compliance",
  },
  {
    slug: "documents.view",
    label: "View document expiry",
    category: "compliance",
  },
  {
    slug: "documents.manage",
    label: "Manage document expiry",
    category: "compliance",
  },
  { slug: "earnings.view", label: "View earnings", category: "earnings" },
  { slug: "earnings.manage", label: "Manage earnings", category: "earnings" },
  { slug: "audit.view", label: "View activity logs", category: "admin" },
  { slug: "audit.export", label: "Export activity logs", category: "admin" },
  {
    slug: "notifications.view",
    label: "View notifications",
    category: "notifications",
  },
  {
    slug: "notifications.manage",
    label: "Manage notifications",
    category: "notifications",
  },
  {
    slug: "notifications.approve",
    label: "Approve notifications",
    category: "notifications",
  },
  {
    slug: "notifications.send",
    label: "Send notifications",
    category: "notifications",
  },
  {
    slug: "notifications.export",
    label: "Export notification reports",
    category: "notifications",
  },
  { slug: "support.view", label: "View support", category: "support" },
  { slug: "support.manage", label: "Manage support", category: "support" },
  { slug: "settings.view", label: "View settings", category: "settings" },
  { slug: "settings.manage", label: "Manage settings", category: "settings" },
  {
    slug: "users.manage",
    label: "Manage users and approvals",
    category: "admin",
  },
  {
    slug: "roles.manage",
    label: "Manage roles and permissions",
    category: "admin",
  },
  {
    slug: "data.cleanup",
    label: "Permanent data cleanup (super admin)",
    category: "admin",
  },
  // releases.manage removed — App Releases / sideload OTA decommissioned (Play Store only).
] as const;

export const CATALOG_SLUGS = PERMISSION_CATALOG.map((e) => e.slug);

export const CATALOG_SLUG_SET = new Set<string>(CATALOG_SLUGS);

export function slugifyRoleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function isValidRoleSlug(slug: string): boolean {
  return /^[a-z][a-z0-9_]{0,47}$/.test(slug);
}
