import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { firstChildHref } from "@/lib/menu/inline-group-nav";
import type { ResolvedMenuNode } from "@/lib/menu/menu-merge";
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
  "restaurants",
  "notifications",
  "attendance",
  "roles",
  "profile",
  "document-expiry",
  "driver-app",
  "app-releases",
  "assets",
  "operations-dashboard",
  "client-portal",
  "vehicles",
  "operations-hub",
  "payroll",
  "assistant",
] as const;

export const LAUNCHER_RELEASE = "3.4";

export type LauncherTileId = (typeof LAUNCHER_TILE_IDS)[number];

/**
 * Home Launcher doors, in the same order as the sidebar.
 * The five hubs stay, plus the other root rows: Live tracking, Employees,
 * Deliveries, Notifications, Roles & Permissions, Settings, and System.
 * Dashboard itself is not a tile. Nested hub cards stay off this grid.
 */
export const LAUNCHER_HOME_TILE_IDS = [
  "live-tracking",
  "drivers",
  "vehicles",
  "deliveries",
  "payroll-hub",
  "operations-hub",
  "notifications",
  "roles",
  "employeedesk",
  "visit-bookings",
  "group-settings",
  "group-system",
] as const;

/**
 * Launcher-only hide list — everything the catalogue knows that the Home grid
 * does not draw. These surfaces keep their route, sidebar row and permission;
 * they just do not get a tile. Derived so it cannot drift from
 * `LAUNCHER_HOME_TILE_IDS`.
 *
 * These are the sidebar root rows. Every other catalogue id stays off the
 * grid and keeps its route, sidebar row, and permission.
 */
const HOME_TILE_SET = new Set<string>(LAUNCHER_HOME_TILE_IDS);

export const LAUNCHER_HIDDEN_TILE_IDS: ReadonlySet<string> = new Set(
  LAUNCHER_TILE_IDS.filter((id) => !HOME_TILE_SET.has(id)),
);

/**
 * Apps that no longer carry a Home tile (they live inside Operations or
 * Settings) but are still real permission surfaces in Roles & Permissions.
 * They keep an entry in `APP_ACCESS_CATALOG` so a per-user tick can still be
 * given for them; they must never be added to `LAUNCHER_TILE_IDS` or they
 * would reappear as launcher tiles.
 */
export const APP_ACCESS_EXTRA_MODULE_IDS = ["performance"] as const;

export type AppAccessModuleId =
  | LauncherTileId
  | (typeof APP_ACCESS_EXTRA_MODULE_IDS)[number];

export const LAUNCHER_LABEL_OVERRIDE: Partial<Record<AppAccessModuleId, string>> = {
  "dashboard-ops": "Dashboard",
  "live-tracking-v2": "Live tracking",
  "driver-groups": "Driver groups",
  drivers: "Drivers",
  deliveries: "Deliveries",
  employeedesk: "Request & Complaint",
  "visit-bookings": "Visit Bookings",
  "dpd-verification": "Verification",
  earnings: "Earnings",
  restaurants: "Restaurants",
  notifications: "Notifications",
  attendance: "Attendance",
  roles: "Roles & Permissions",
  profile: "Settings",
  "document-expiry": "Document expiry",
  "driver-app": "Driver App",
  "app-releases": "App Releases",
  assets: "Assets",
  payroll: "Payroll",
};

const TILE_SET = new Set<string>(LAUNCHER_TILE_IDS);

/** The launcher itself; a sidebar row pointing here is not a second app. */
const LAUNCHER_SELF_HREF = "/dashboard";

/**
 * One Home Launcher tile, derived from the sidebar tree rather than a second
 * hand-kept list — the dashboard cannot show a door the sidebar has closed, or
 * lose one it shows.
 */
export interface LauncherTile {
  id: string;
  href: string;
  /** The sidebar's resolved label; the shell prefers the `nav.*` translation. */
  label: string;
  icon: string;
}

/**
 * Mirror the sidebar rows onto the launcher.
 *
 * - A root item is one tile.
 * - An inline group is the single row the sidebar paints for it.
 * - Any other group contributes its children, because those are the rows the
 *   sidebar lists underneath the group label.
 *
 * `resolveForSidebar` has already removed hidden registry rows and anything the
 * session cannot open, so permission filtering is identical by construction.
 */
export function launcherTilesFromMenu(
  nodes: readonly ResolvedMenuNode[],
): LauncherTile[] {
  const tiles: LauncherTile[] = [];
  const seen = new Set<string>();

  const add = (
    id: string,
    href: string | undefined | null,
    label: string,
    icon: string,
  ) => {
    if (!href || href === LAUNCHER_SELF_HREF) return;
    if (seen.has(id)) return;
    seen.add(id);
    tiles.push({ id, href, label, icon });
  };

  for (const node of nodes) {
    if (node.type === "item") {
      add(node.id, node.href, node.label, node.icon);
      continue;
    }
    if (node.displayMode === "inline") {
      add(node.id, node.href ?? firstChildHref(node), node.label, node.icon);
      continue;
    }
    for (const child of node.children ?? []) {
      if (child.type !== "item") continue;
      add(child.id, child.href, child.label, child.icon);
    }
  }

  return tiles;
}

/**
 * The sidebar root rows, in `LAUNCHER_HOME_TILE_IDS` order.
 *
 * The sidebar rows and the curated registry list are both sources, because a
 * nested hub child may be the only row that points at a door the sidebar paints
 * as a group. Both passes drop every id outside `LAUNCHER_HOME_TILE_IDS` and
 * both are de-duped by id and href. A hub the session cannot open leaves its
 * cell empty.
 */
export function mergeLauncherTiles(
  derived: readonly LauncherTile[],
  curated: readonly MenuRegistryItem[],
): LauncherTile[] {
  const byId = new Map<string, LauncherTile>();
  const hrefs = new Set<string>();

  for (const tile of derived) {
    if (LAUNCHER_HIDDEN_TILE_IDS.has(tile.id)) continue;
    if (!HOME_TILE_SET.has(tile.id)) continue;
    if (byId.has(tile.id) || hrefs.has(tile.href)) continue;
    hrefs.add(tile.href);
    byId.set(tile.id, tile);
  }
  for (const item of curated) {
    if (LAUNCHER_HIDDEN_TILE_IDS.has(item.id)) continue;
    if (!HOME_TILE_SET.has(item.id)) continue;
    if (byId.has(item.id) || hrefs.has(item.href)) continue;
    hrefs.add(item.href);
    byId.set(item.id, {
      id: item.id,
      href: item.href,
      label: item.defaultLabel,
      icon: item.defaultIcon,
    });
  }

  return LAUNCHER_HOME_TILE_IDS.flatMap((id) => {
    const tile = byId.get(id);
    return tile ? [tile] : [];
  });
}

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

type LauncherFilterable = {
  id: string;
  href: string;
  label?: string;
  defaultLabel?: string;
};

export function filterLauncherTiles<T extends LauncherFilterable>(
  items: readonly T[],
  query: string,
  labels: ReadonlyMap<string, string>,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    const label = (
      labels.get(item.id) ??
      item.label ??
      item.defaultLabel ??
      ""
    ).toLowerCase();
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
