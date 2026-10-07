import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { MENU_REGISTRY, type MenuRegistryItem } from "@/lib/menu/menu-registry";

/**
 * Module-level tiles on the Home Launcher. Nested EmployeeDesk / Settings
 * children stay in the sidebar; they are not a second set of apps.
 */
export const LAUNCHER_TILE_IDS = [
  "dashboard-ops",
  "live-tracking-v2",
  "driver-groups",
  "drivers",
  "deliveries",
  "employeedesk",
  "visit-bookings",
  "dpd-verification",
  "earnings",
  "notifications",
  "attendance",
  "profile",
  "assets",
  "operations-hub",
  "vehicles",
  "payroll",
  "performance",
  "assistant",
] as const;

export type LauncherTileId = (typeof LAUNCHER_TILE_IDS)[number];

/**
 * Apps that no longer carry a Home tile (they live inside Operations or
 * Settings) but are still real permission surfaces in Roles & Permissions.
 * They keep an entry in `APP_ACCESS_CATALOG` so a per-user tick can still be
 * given for them; they must never be added to `LAUNCHER_TILE_IDS` or they
 * would reappear as launcher tiles.
 */
export const APP_ACCESS_EXTRA_MODULE_IDS = [
  "restaurants",
  "roles",
  "document-expiry",
  "driver-app",
] as const;

export type AppAccessModuleId =
  | LauncherTileId
  | (typeof APP_ACCESS_EXTRA_MODULE_IDS)[number];

export const LAUNCHER_LABEL_OVERRIDE: Partial<Record<AppAccessModuleId, string>> = {
  "dashboard-ops": "Dashboard",
  "live-tracking-v2": "Live tracking",
  "visit-bookings": "Visit Bookings",
  "dpd-verification": "Verification",
  earnings: "Earnings",
  profile: "Settings",
  assets: "Assets",
  roles: "Roles & Permissions",
};

const TILE_SET = new Set<string>(LAUNCHER_TILE_IDS);

export function launcherRegistryItems(): MenuRegistryItem[] {
  const order = new Map(LAUNCHER_TILE_IDS.map((id, index) => [id, index]));
  return MENU_REGISTRY.filter((item) => TILE_SET.has(item.id)).sort(
    (a, b) =>
      (order.get(a.id as LauncherTileId) ?? 99) - (order.get(b.id as LauncherTileId) ?? 99),
  );
}

function itemAllowed(
  item: MenuRegistryItem,
  permissions: ReadonlySet<Permission> | readonly Permission[],
  isSuperAdmin: boolean,
): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  if (item.permissionAnyOf?.length) {
    return item.permissionAnyOf.some((slug) =>
      hasPermissionInSet(set, slug, isSuperAdmin),
    );
  }
  if (item.permission) {
    return hasPermissionInSet(set, item.permission, isSuperAdmin);
  }
  return true;
}

export function visibleLauncherTiles(
  permissions: ReadonlySet<Permission> | readonly Permission[],
  isSuperAdmin: boolean,
): MenuRegistryItem[] {
  return launcherRegistryItems().filter((item) => itemAllowed(item, permissions, isSuperAdmin));
}

export function filterLauncherTiles(
  items: readonly MenuRegistryItem[],
  query: string,
  labels: ReadonlyMap<string, string>,
): MenuRegistryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    const label = (labels.get(item.id) ?? item.defaultLabel).toLowerCase();
    const override = (LAUNCHER_LABEL_OVERRIDE[item.id as LauncherTileId] ?? "").toLowerCase();
    return (
      label.includes(q) ||
      override.includes(q) ||
      item.id.includes(q) ||
      item.href.toLowerCase().includes(q)
    );
  });
}

export function greetingBucket(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function kuwaitHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? now.getHours());
}
