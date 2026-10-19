import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { firstChildHref } from "@/lib/menu/inline-group-nav";
import type { ResolvedMenuNode } from "@/lib/menu/menu-merge";
import {
  MENU_REGISTRY,
  OPERATIONS_HUB_GROUP,
  type MenuRegistryItem,
} from "@/lib/menu/menu-registry";

/**
 * Module-level tiles on the Home Launcher. Nested EmployeeDesk / Settings
 * children stay in the sidebar; they are not a second set of apps.
 */
export const LAUNCHER_TILE_IDS = [
  "dashboard-ops",
  "live-tracking-v2",
  "drivers",
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
 * Launcher sections mirror the sidebar's own groups rather than inventing a
 * second taxonomy: a tile is filed under the group that holds its row, so the
 * launcher and the rail cannot disagree about where a module lives.
 */
export type LauncherSectionId =
  | "employeedesk"
  | "operations"
  | "fleet"
  | "settings"
  | "system";

export interface LauncherSection {
  id: LauncherSectionId;
  /** next-intl key under `appNavGroups`. */
  labelKey: string;
  /** Name in `ICON_MAP`. */
  icon: string;
}

export const LAUNCHER_SECTIONS: readonly LauncherSection[] = [
  { id: "employeedesk", labelKey: "appNavGroups.employeedesk", icon: "Inbox" },
  { id: "operations", labelKey: "appNavGroups.operations", icon: "Activity" },
  { id: "fleet", labelKey: "appNavGroups.fleet", icon: "Truck" },
  { id: "settings", labelKey: "appNavGroups.settings", icon: "Settings" },
  { id: "system", labelKey: "appNavGroups.system", icon: "Cog" },
];

const SECTION_BY_GROUP: Record<string, LauncherSectionId> = {
  Overview: "operations",
  EmployeeDesk: "employeedesk",
  "Visit Bookings": "employeedesk",
  [OPERATIONS_HUB_GROUP]: "operations",
  Operations: "operations",
  Payroll: "operations",
  Fleet: "fleet",
  Settings: "settings",
  System: "system",
  WIP: "system",
  Unorganised: "operations",
};

export function sectionForTile(id: string): LauncherSectionId {
  const item = MENU_REGISTRY.find((entry) => entry.id === id);
  return SECTION_BY_GROUP[item?.defaultGroup ?? ""] ?? "operations";
}

export interface LauncherSectionGroup {
  section: LauncherSection;
  tiles: LauncherTile[];
}

/**
 * Group tiles for rendering, in section order. Empty sections are dropped, so
 * a role that cannot open Fleet does not get a Fleet Hub heading over nothing.
 */
export function groupLauncherTiles(
  tiles: readonly LauncherTile[],
): LauncherSectionGroup[] {
  const buckets = new Map<LauncherSectionId, LauncherTile[]>();
  for (const tile of tiles) {
    const id = tile.sectionId ?? sectionForTile(tile.id);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(tile);
    else buckets.set(id, [tile]);
  }
  return LAUNCHER_SECTIONS.flatMap((section) => {
    const bucket = buckets.get(section.id);
    return bucket?.length ? [{ section, tiles: bucket }] : [];
  });
}

/**
 * Launcher-only hide list. These surfaces keep their route, sidebar row and
 * permission — they just do not get a Home tile. Filtering happens in
 * `mergeLauncherTiles`, so `LAUNCHER_TILE_IDS` (and the Roles app catalogue)
 * still describes every real surface.
 */
export const LAUNCHER_HIDDEN_TILE_IDS: ReadonlySet<string> = new Set([
  "dashboard-ops",
  "payroll",
  "earnings",
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
  /** Launcher section the tile is filed under. */
  sectionId: LauncherSectionId;
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
    tiles.push({ id, href, label, icon, sectionId: sectionForTile(id) });
  };

  for (const node of nodes) {
    if (node.type === "item") {
      add(node.id, node.href, node.label, node.icon);
      continue;
    }
    if (node.displayMode === "inline") {
      add(node.id, firstChildHref(node), node.label, node.icon);
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
 * paint (`assets`, `dpd-verification`, `earnings` are `hidden: true` in the
 * registry — they are launcher surfaces, not sidebar ones).
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
      sectionId: sectionForTile(item.id),
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
