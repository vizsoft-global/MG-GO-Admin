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
  "drivers",
  "operations-dashboard",
  "client-portal",
  "driver-groups",
  "deliveries",
  "attendance",
  "dpd-verification",
  "employeedesk",
  "visit-bookings",
  "vehicles",
  "operations-hub",
  "payroll",
  "earnings",
  "notifications",
  "assets",
  "profile",
  "assistant",
] as const;

export type LauncherTileId = (typeof LAUNCHER_TILE_IDS)[number];

/**
 * Launcher-only hide list. These surfaces keep their route, sidebar row and
 * permission — they just do not get a Home tile. Filtering happens in
 * `mergeLauncherTiles`, so `LAUNCHER_TILE_IDS` (and the Roles app catalogue)
 * still describes every real surface.
 *
 * `dpd-verification`, `assets` and `driver-groups` are here because each is
 * reached through its own hub card; the Home grid is the module picker, not a
 * second sidebar, so those three do not need a door of their own.
 */
export const LAUNCHER_HIDDEN_TILE_IDS: ReadonlySet<string> = new Set([
  "dashboard-ops",
  "payroll",
  "earnings",
  "dpd-verification",
  "assets",
  "driver-groups",
  "attendance",
]);

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
  "performance",
] as const;

export type AppAccessModuleId =
  | LauncherTileId
  | (typeof APP_ACCESS_EXTRA_MODULE_IDS)[number];

export const LAUNCHER_LABEL_OVERRIDE: Partial<Record<AppAccessModuleId, string>> = {
  "dashboard-ops": "Dashboard",
  "live-tracking-v2": "Live tracking",
  "visit-bookings": "Visit Slots",
  "dpd-verification": "Verification",
  earnings: "Earnings",
  profile: "Settings",
  assets: "Assets",
  payroll: "Payroll",
  roles: "Roles & Permissions",
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
 * The sidebar's rows first, then any launcher-only door the sidebar does not
 * paint (nested hub children, and the `hidden: true` registry rows). Both
 * passes drop `LAUNCHER_HIDDEN_TILE_IDS`, so a hidden id can never come back
 * through the curated list.
 *
 * Dedupe is by id **and** href: an inline group and its first child both point
 * at the same page, and a dashboard with two Settings tiles is worse than one.
 */
export function mergeLauncherTiles(
  derived: readonly LauncherTile[],
  curated: readonly MenuRegistryItem[],
): LauncherTile[] {
  const out: LauncherTile[] = [];
  const ids = new Set<string>();
  const hrefs = new Set<string>();

  for (const tile of derived) {
    if (LAUNCHER_HIDDEN_TILE_IDS.has(tile.id)) continue;
    if (ids.has(tile.id) || hrefs.has(tile.href)) continue;
    ids.add(tile.id);
    hrefs.add(tile.href);
    out.push(tile);
  }
  for (const item of curated) {
    if (LAUNCHER_HIDDEN_TILE_IDS.has(item.id)) continue;
    if (ids.has(item.id) || hrefs.has(item.href)) continue;
    ids.add(item.id);
    hrefs.add(item.href);
    out.push({
      id: item.id,
      href: item.href,
      label: item.defaultLabel,
      icon: item.defaultIcon,
    });
  }
  return out;
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
