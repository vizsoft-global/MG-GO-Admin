import {
  DEFAULT_GROUPS,
  DEFAULT_GROUP_META,
  MENU_REGISTRY,
  type MenuRegistryItem,
} from "@/lib/menu/menu-registry";
import type { MenuNode } from "@/services/menu-config-service";
import type { Permission } from "@/lib/auth/permissions";

export interface ResolvedMenuNode {
  id: string;
  type: "item" | "group";
  label: string;
  icon: string;
  href?: string;
  displayMode?: "inline" | "panel";
  permission?: Permission;
  superAdminOnly?: boolean;
  footer?: boolean;
  children?: ResolvedMenuNode[];
}

function registryMap(): Map<string, MenuRegistryItem> {
  const m = new Map<string, MenuRegistryItem>();
  for (const r of MENU_REGISTRY) m.set(r.id, r);
  return m;
}

function collectIdsFromTree(nodes: MenuNode[], set: Set<string>) {
  for (const n of nodes) {
    if (n.type === "item") set.add(n.id);
    if (n.children) collectIdsFromTree(n.children, set);
  }
}

export function buildDefaultTree(): MenuNode[] {
  const groups = new Map<string, MenuNode>();
  for (const g of DEFAULT_GROUPS) {
    const meta = DEFAULT_GROUP_META[g];
    groups.set(g, {
      id: `group-${g.toLowerCase()}`,
      type: "group",
      label: g,
      icon: meta?.icon ?? "Folder",
      displayMode: meta?.displayMode,
      children: [],
    });
  }
  const sorted = [...MENU_REGISTRY].sort((a, b) => a.defaultOrder - b.defaultOrder);
  for (const r of sorted) {
    if (r.hidden) continue;
    const g = groups.get(r.defaultGroup);
    if (g) {
      g.children!.push({
        id: r.id,
        type: "item",
        label: r.defaultLabel,
        icon: r.defaultIcon,
        hidden: false,
      });
    }
  }
  return Array.from(groups.values()).filter((g) => (g.children?.length ?? 0) > 0);
}

function mergeGeneric(
  config: MenuNode[],
  registryIds: Set<string>,
  defaults: MenuNode[],
): { pruned: MenuNode[]; unassigned: string[] } {
  const source = config.length > 0 ? config : defaults;
  const prune = (nodes: MenuNode[]): MenuNode[] =>
    nodes
      .map((n) => {
        if (n.type === "item") return registryIds.has(n.id) ? { ...n } : null;
        const children = n.children ? prune(n.children) : [];
        return { ...n, children };
      })
      .filter((n): n is MenuNode => n !== null);

  const pruned = prune(source);
  const existing = new Set<string>();
  collectIdsFromTree(pruned, existing);
  const unassigned: string[] = [];
  const hiddenIds = new Set(MENU_REGISTRY.filter((item) => item.hidden).map((item) => item.id));
  registryIds.forEach((id) => {
    if (existing.has(id)) return;
    if (hiddenIds.has(id)) return;
    unassigned.push(id);
  });
  return { pruned, unassigned };
}

export function mergeMenu(config: MenuNode[]): {
  tree: MenuNode[];
  unassignedIds: string[];
} {
  const reg = registryMap();
  const ids = new Set(MENU_REGISTRY.map((r) => r.id));
  const { pruned, unassigned } = mergeGeneric(config, ids, buildDefaultTree());

  if (unassigned.length > 0) {
    const skipGroups = new Set([
      "Unorganised",
      "EmployeeDesk",
      "OperationsHub",
      "Fleet",
      "WIP",
      "Visit Bookings",
    ]);
    for (const id of unassigned) {
      const r = reg.get(id);
      if (!r) continue;
      const child = {
        id,
        type: "item" as const,
        label: r.defaultLabel,
        icon: r.defaultIcon,
        hidden: false,
      };
      if (skipGroups.has(r.defaultGroup)) {
        pruned.push(child);
        continue;
      }
      const gid = `group-${r.defaultGroup.toLowerCase()}`;
      const idx = pruned.findIndex((n) => n.id === gid);
      if (idx >= 0) {
        pruned[idx] = {
          ...pruned[idx],
          children: [...(pruned[idx].children || []), child],
        };
      } else {
        pruned.push(child);
      }
    }
  }

  // A saved Menu Editor config is the sidebar. The relocators below only
  // shape a role that has never been saved — running them on a save puts
  // every edit back, which is why the sidebar ignored the editor.
  const arranged =
    config.length > 0
      ? pruned
      : placeSidebarTail(
          relocateSettingsSplit(
            relocatePayrollItem(
              relocateOrderReconItem(
                relocateAssistantItem(
                  relocateFleetItems(
                    relocateVisitBookingsItems(relocateOperationsHubItems(pruned)),
                  ),
                ),
              ),
            ),
          ),
        );

  return {
    tree: remapClientIaSavedMenu(
      dropRegistryHiddenItems(dropAppsGroup(stripStaffAccessItem(arranged))),
    ),
    unassignedIds: unassigned,
  };
}

const FLEET_GROUP_ID = "group-fleet";
const FLEET_HUB_ID = "vehicles";

function relocateFleetItems(tree: MenuNode[]): MenuNode[] {
  const fleetIds = new Set(
    MENU_REGISTRY.filter((item) => item.defaultGroup === "Fleet").map((item) => item.id),
  );
  let hubIcon = "Truck";

  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === FLEET_HUB_ID) hubIcon = node.icon || hubIcon;
        if (fleetIds.has(node.id)) return [];
        return [node];
      }
      if (node.id === FLEET_GROUP_ID) {
        for (const child of node.children ?? []) {
          if (child.type === "item" && child.id === FLEET_HUB_ID) hubIcon = child.icon || hubIcon;
        }
        return [];
      }
      const children = node.children ? strip(node.children) : [];
      if (children.length === 0) return [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const registry = MENU_REGISTRY.find((item) => item.id === FLEET_HUB_ID);
  const item: MenuNode = {
    id: FLEET_HUB_ID,
    type: "item",
    label: registry?.defaultLabel ?? "Fleet Hub",
    icon: hubIcon || registry?.defaultIcon || "Car",
    hidden: false,
  };

  const verificationList = findChildList(stripped, "dpd-verification");
  if (verificationList) {
    const verificationIdx = verificationList.findIndex((node) => node.id === "dpd-verification");
    verificationList.splice(verificationIdx, 0, item);
    return stripped;
  }
  const deliveriesList = findChildList(stripped, "deliveries");
  if (deliveriesList) {
    const deliveriesIdx = deliveriesList.findIndex((node) => node.id === "deliveries");
    deliveriesList.splice(deliveriesIdx + 1, 0, item);
    return stripped;
  }
  const ops = stripped.find((node) => node.id === "group-operations");
  if (ops) {
    ops.children = [...(ops.children ?? []), item];
    return stripped;
  }
  return [...stripped, item];
}

const VISIT_BOOKINGS_GROUP = "Visit Bookings";
const VISIT_BOOKINGS_ID = "visit-bookings";
const VISIT_BOOKINGS_GROUP_ID = "group-visit bookings";

function relocateVisitBookingsItems(tree: MenuNode[]): MenuNode[] {
  const visitIds = new Set(
    MENU_REGISTRY.filter((item) => item.defaultGroup === VISIT_BOOKINGS_GROUP).map((item) => item.id),
  );
  let visitIcon = "Table2";

  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === VISIT_BOOKINGS_ID) visitIcon = node.icon || visitIcon;
        if (visitIds.has(node.id)) return [];
        return [node];
      }
      if (node.id === VISIT_BOOKINGS_GROUP_ID) {
        for (const child of node.children ?? []) {
          if (child.type === "item" && child.id === VISIT_BOOKINGS_ID) visitIcon = child.icon || visitIcon;
        }
        return [];
      }
      const children = node.children ? strip(node.children) : [];
      if (children.length === 0) return [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const registry = MENU_REGISTRY.find((item) => item.id === VISIT_BOOKINGS_ID);
  const item: MenuNode = {
    id: VISIT_BOOKINGS_ID,
    type: "item",
    label: registry?.defaultLabel ?? "Visit Slots",
    icon: visitIcon || registry?.defaultIcon || "Table2",
    hidden: false,
  };

  const employeeIdx = stripped.findIndex(
    (node) => node.id === "group-employeedesk" || node.id === "employeedesk",
  );
  const next = [...stripped];
  next.splice(employeeIdx >= 0 ? employeeIdx + 1 : 0, 0, item);
  return next;
}

function relocateAssistantItem(tree: MenuNode[]): MenuNode[] {
  const ASSISTANT_ID = "assistant";
  let found: MenuNode | null = null;
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === ASSISTANT_ID) {
          found = { ...node, hidden: false };
          return [];
        }
        return [node];
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const item: MenuNode = found ?? {
    id: ASSISTANT_ID,
    type: "item",
    label: "Staff Assistant",
    icon: "Sparkles",
    hidden: false,
  };

  const systemIdx = stripped.findIndex((node) => node.id === SYSTEM_GROUP_ID);
  if (systemIdx < 0) {
    return [...stripped, { ...groupNodeFor(SYSTEM_GROUP_ID), children: [item] }];
  }

  const system = stripped[systemIdx];
  const children = [...(system.children ?? [])].filter((child) => child.id !== ASSISTANT_ID);
  children.push(item);
  const next = [...stripped];
  next[systemIdx] = { ...system, children };
  return next;
}

function relocatePayrollItem(tree: MenuNode[]): MenuNode[] {
  const PAYROLL_ID = "payroll";
  const GROUP_ID = "group-payroll";
  let foundIcon = "Banknote";
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === PAYROLL_ID) {
          foundIcon = node.icon || "Banknote";
          return [];
        }
        return [node];
      }
      if (node.id === GROUP_ID) {
        const rest: MenuNode[] = [];
        for (const child of node.children ?? []) {
          if (child.id === PAYROLL_ID) foundIcon = child.icon || "Banknote";
          else rest.push(child);
        }
        return rest;
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree).filter(
    (node) => node.type === "item" || (node.children?.length ?? 0) > 0,
  );
  const item: MenuNode = {
    id: PAYROLL_ID,
    type: "item",
    label: "Payroll",
    icon: foundIcon,
    hidden: false,
  };

  const payoutsList = findChildList(stripped, "payouts");
  if (payoutsList) {
    const payoutsIdx = payoutsList.findIndex((node) => node.id === "payouts");
    payoutsList.splice(payoutsIdx + 1, 0, item);
    return stripped;
  }
  const opsIdx = stripped.findIndex((node) => node.id === "group-operations");
  if (opsIdx >= 0) {
    const ops = stripped[opsIdx];
    const next = [...stripped];
    next[opsIdx] = { ...ops, children: [...(ops.children ?? []), item] };
    return next;
  }
  return [...stripped, item];
}

function relocateOrderReconItem(tree: MenuNode[]): MenuNode[] {
  const RECON_ID = "order-reconciliation";
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item" && node.id === RECON_ID) return [];
      if (!node.children?.length) return [node];
      const children = strip(node.children);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });
  return strip(tree);
}

const SETTINGS_GROUP_ID = "group-settings";
const SYSTEM_GROUP_ID = "group-system";

/**
 * Settings keeps platform **administration** — the staff who may use the panel,
 * the roles they hold, the branding, the audit log. Each module's own
 * configuration sits beside that module, and platform **configuration** gets its
 * own System group.
 *
 * `buildDefaultTree()` already derives that shape from `MENU_REGISTRY`, so this
 * is not needed for a fresh install — it exists for the saved `menu_configs`. A
 * tenant who opened the Menu Editor before this split has all seventeen items
 * sitting inside `group-settings`, and pruning alone would leave every one of
 * them there. Without this the IA change would apply to new accounts and to
 * nobody else, which is the difference between shipping a menu and shipping a
 * default.
 *
 * The operational half of that split is not here — it belongs to
 * `relocateOperationsHubItems`, which must run *before* this so an item it moves
 * is not left looking like a System item.
 */
const SETTINGS_SPLIT: ReadonlyArray<{ id: string; group: string; after?: string }> = [
  { id: "driver-app", group: SYSTEM_GROUP_ID },
  { id: "document-expiry", group: SYSTEM_GROUP_ID },
  { id: "storage", group: SYSTEM_GROUP_ID },
  { id: "maintenance", group: SYSTEM_GROUP_ID },
  { id: "languages", group: SYSTEM_GROUP_ID },
  { id: "data-cleanup", group: SYSTEM_GROUP_ID },
  { id: "assistant", group: SYSTEM_GROUP_ID },
  { id: "driver-devices", group: SETTINGS_GROUP_ID },
];

const SETTINGS_SPLIT_BY_ID = new Map(SETTINGS_SPLIT.map((entry) => [entry.id, entry]));

const OPERATIONS_HUB_GROUP_ID = "group-operationshub";

/**
 * Operational configuration lives in OperationsHub, never in Settings.
 *
 * `buildDefaultTree()` derives that from `defaultGroup` on `MENU_REGISTRY`, so a
 * fresh install is already correct. This exists for saved `menu_configs`, where a
 * tenant who opened the Menu Editor before the split has `partners`,
 * `restaurants`, `zones`, `delivery-rules`, `incentive-rules`, `driver-fields`
 * and `attendance-settings` living inside `group-settings`, and
 * `source-companies` inside `group-fleet`. Fleet children other than the hub
 * are hidden and stripped by `relocateFleetItems`, which runs after this
 * collection so a hub item parked in Fleet is not dropped with the group.
 *
 * It deliberately runs **before** `relocateFleetItems`: that function rebuilds
 * the Fleet group from the registry, so an item parked there whose
 * `defaultGroup` is no longer `Fleet` would be dropped on the floor before this
 * could collect it.
 *
 * Order inside the group is registry order (`operations-hub` first, then
 * ascending `defaultOrder`), and any customisation the tenant made — label,
 * icon, hidden — is carried over from the node that was found.
 */
const OPERATIONS_HUB_IDS = [
  "operations-hub",
  "partners",
  "restaurants",
  "zones",
  "delivery-rules",
  "incentive-rules",
  "driver-fields",
  "attendance-settings",
  "source-companies",
  "earnings",
] as const;

const OPERATIONS_HUB_ID_SET = new Set<string>(OPERATIONS_HUB_IDS);

function relocateOperationsHubItems(tree: MenuNode[]): MenuNode[] {
  const collected = new Map<string, MenuNode>();

  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (OPERATIONS_HUB_ID_SET.has(node.id)) {
          collected.set(node.id, node);
          return [];
        }
        return [node];
      }
      // An older OperationsHub group is rebuilt below, so it is removed whole
      // rather than nested inside the fresh one.
      if (node.id === OPERATIONS_HUB_GROUP_ID) {
        for (const child of node.children ?? []) {
          if (child.type === "item") collected.set(child.id, child);
        }
        return [];
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const existing = collected.get("operations-hub");
  const hub: MenuNode = existing
    ? { ...existing, hidden: false }
    : {
        id: "operations-hub",
        type: "item",
        label: "OperationsHub",
        icon: "Building2",
        hidden: false,
      };

  if (stripped.some((node) => node.id === "operations-hub")) return stripped;
  return [...stripped, hub].filter(
    (node) => node.type === "item" || (node.children?.length ?? 0) > 0,
  );
}

function findChildList(nodes: MenuNode[], id: string): MenuNode[] | null {
  if (nodes.some((node) => node.id === id)) return nodes;
  for (const node of nodes) {
    if (!node.children?.length) continue;
    const found = findChildList(node.children, id);
    if (found) return found;
  }
  return null;
}

function detachNode(tree: MenuNode[], id: string): { tree: MenuNode[]; node: MenuNode | null } {
  let found: MenuNode | null = null;
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.id === id && !found) {
        found = node;
        return [];
      }
      if (!node.children?.length) return [node];
      return [{ ...node, children: walk(node.children) }];
    });
  return {
    tree: walk(tree).filter((node) => node.type === "item" || (node.children?.length ?? 0) > 0),
    node: found,
  };
}

const OPERATIONS_HUB_ITEM_ID = "operations-hub";
const UNORGANISED_GROUP_ID = "group-unorganised";

/**
 * OperationsHub, Attendance, and Visit Slots sit after System as root rows.
 * The OperationsHub group and Unorganised dump are never re-inserted.
 */
function placeSidebarTail(tree: MenuNode[]): MenuNode[] {
  const hubItem = detachNode(tree, OPERATIONS_HUB_ITEM_ID);
  const attendance = detachNode(hubItem.tree, "attendance");
  const visit = detachNode(attendance.tree, VISIT_BOOKINGS_ID);
  const hubGroup = detachNode(visit.tree, OPERATIONS_HUB_GROUP_ID);
  const unorganised = detachNode(hubGroup.tree, UNORGANISED_GROUP_ID);
  const rest = unorganised.tree;
  const systemIdx = rest.findIndex((node) => node.id === SYSTEM_GROUP_ID);
  const insertAt = systemIdx >= 0 ? systemIdx + 1 : rest.length;
  const cluster = [hubItem.node, attendance.node, visit.node].filter(
    (node): node is MenuNode => node !== null,
  );
  const next = [...rest];
  next.splice(insertAt, 0, ...cluster);
  return next;
}

function groupNodeFor(groupId: string): MenuNode {
  const label = DEFAULT_GROUPS.find((g) => `group-${g.toLowerCase()}` === groupId) ?? "Unorganised";
  const meta = DEFAULT_GROUP_META[label];
  return {
    id: groupId,
    type: "group",
    label,
    icon: meta?.icon ?? "Folder",
    displayMode: meta?.displayMode,
    children: [],
  };
}

function relocateSettingsSplit(tree: MenuNode[]): MenuNode[] {
  const collected = new Map<string, MenuNode>();

  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (SETTINGS_SPLIT_BY_ID.has(node.id)) {
          collected.set(node.id, node);
          return [];
        }
        return [node];
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  let next = strip(tree);
  if (collected.size === 0) return next;

  // Created lazily and placed next to Settings, so an install whose saved config
  // never had a System group does not gain an empty heading.
  const needsSystem = SETTINGS_SPLIT.some(
    (entry) => entry.group === SYSTEM_GROUP_ID && collected.has(entry.id),
  );
  if (needsSystem && !next.some((node) => node.id === SYSTEM_GROUP_ID)) {
    const system = groupNodeFor(SYSTEM_GROUP_ID);
    const settingsIdx = next.findIndex((node) => node.id === SETTINGS_GROUP_ID);
    next =
      settingsIdx >= 0
        ? [...next.slice(0, settingsIdx + 1), system, ...next.slice(settingsIdx + 1)]
        : [...next, system];
  }

  for (const entry of SETTINGS_SPLIT) {
    const item = collected.get(entry.id);
    if (!item) continue;

    const groupIdx = next.findIndex((node) => node.id === entry.group);
    if (groupIdx < 0) {
      // Nowhere to put it: hand it back to Settings rather than dropping it out
      // of the tree, because a node no group holds disappears from the sidebar.
      const fallbackIdx = next.findIndex((node) => node.id === SETTINGS_GROUP_ID);
      if (fallbackIdx < 0) continue;
      const fallback = next[fallbackIdx];
      next[fallbackIdx] = {
        ...fallback,
        children: [...(fallback.children ?? []), item],
      };
      continue;
    }

    const group = next[groupIdx];
    const children = [...(group.children ?? [])];
    const anchorIdx = entry.after
      ? children.findIndex((child) => child.id === entry.after)
      : -1;
    children.splice(anchorIdx >= 0 ? anchorIdx + 1 : children.length, 0, item);
    next = [...next.slice(0, groupIdx), { ...group, children }, ...next.slice(groupIdx + 1)];
  }

  return next;
}

function dropAppsGroup(tree: MenuNode[]): MenuNode[] {
  const apps = tree.find((node) => node.id === "group-apps");
  const rest = tree.filter((node) => node.id !== "group-apps");
  const leftovers = (apps?.children ?? []).filter((child) => child.type === "item");
  if (leftovers.length === 0) return rest;

  const systemIdx = rest.findIndex((node) => node.id === SYSTEM_GROUP_ID);
  if (systemIdx < 0) {
    const system = groupNodeFor(SYSTEM_GROUP_ID);
    system.children = leftovers;
    const settingsIdx = rest.findIndex((node) => node.id === SETTINGS_GROUP_ID);
    if (settingsIdx < 0) return [...rest, system];
    return [...rest.slice(0, settingsIdx + 1), system, ...rest.slice(settingsIdx + 1)];
  }

  const system = rest[systemIdx];
  const next = [...rest];
  next[systemIdx] = { ...system, children: [...(system.children ?? []), ...leftovers] };
  return next;
}

function dropRegistryHiddenItems(tree: MenuNode[]): MenuNode[] {
  const hiddenIds = new Set(MENU_REGISTRY.filter((item) => item.hidden).map((item) => item.id));
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") return hiddenIds.has(node.id) ? [] : [node];
      const children = walk(node.children ?? []);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });
  return walk(tree);
}

function stripStaffAccessItem(tree: MenuNode[]): MenuNode[] {
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item" && node.id === "staff-access") return [];
      if (node.children) return [{ ...node, children: strip(node.children) }];
      return [node];
    });
  return strip(tree);
}

/**
 * Narrow remappers for saved `menu_configs`. The relocator pipeline only
 * runs when a role has never been saved — production menus would otherwise
 * keep September placement. These only move named ids or rewrite one stale
 * label/icon so Menu Editor edits on other rows survive.
 */
function dropSavedMenuItems(tree: MenuNode[], ids: readonly string[]): MenuNode[] {
  const idSet = new Set(ids);
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item" && idSet.has(node.id)) return [];
      if (!node.children?.length) return [node];
      const children = walk(node.children);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });
  return walk(tree);
}

function flattenHubGroup(
  tree: MenuNode[],
  groupId: string,
  hubItemId: string,
): MenuNode[] {
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.id === groupId) {
        const child = node.children?.find((item) => item.id === hubItemId);
        const registry = MENU_REGISTRY.find((item) => item.id === hubItemId);
        return [
          {
            id: hubItemId,
            type: "item" as const,
            label: child?.label ?? registry?.defaultLabel ?? hubItemId,
            icon: child?.icon ?? registry?.defaultIcon ?? "Folder",
            hidden: false,
          },
        ];
      }
      if (!node.children?.length) return [node];
      return [{ ...node, children: walk(node.children) }];
    });
  return dropDuplicateItems(walk(tree), hubItemId);
}

function dropDuplicateItems(tree: MenuNode[], id: string): MenuNode[] {
  let seen = false;
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.id === id) {
        if (seen) return [];
        seen = true;
        return [node];
      }
      if (!node.children?.length) return [node];
      const children = walk(node.children);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });
  return walk(tree);
}

function dropUnorganisedGroup(tree: MenuNode[]): MenuNode[] {
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.id === UNORGANISED_GROUP_ID || node.id === "group-unassigned") return [];
      if (!node.children?.length) return [node];
      const children = walk(node.children);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });
  return walk(tree);
}

function stripPanelDisplayMode(tree: MenuNode[]): MenuNode[] {
  return tree.map((node) => {
    const children = node.children ? stripPanelDisplayMode(node.children) : node.children;
    if (node.type === "group" && node.displayMode === "panel") {
      return { ...node, displayMode: undefined, children };
    }
    return children === node.children ? node : { ...node, children };
  });
}

function remapClientIaSavedMenu(tree: MenuNode[]): MenuNode[] {
  let next = dropSavedMenuItems(tree, ["requests"]);
  next = remapItemsToGroup(next, ["driver-devices"], SETTINGS_GROUP_ID);
  next = remapItemsToGroup(next, ["assistant"], SYSTEM_GROUP_ID);
  next = remapItemsToGroup(next, ["wrong-actions"], "group-operations");
  next = remapItemsToGroup(next, ["support"], SETTINGS_GROUP_ID);
  next = flattenHubGroup(next, "group-employeedesk", "employeedesk");
  next = flattenHubGroup(next, OPERATIONS_HUB_GROUP_ID, OPERATIONS_HUB_ITEM_ID);
  next = flattenHubGroup(next, FLEET_GROUP_ID, FLEET_HUB_ID);
  next = dropUnorganisedGroup(next);
  next = stripPanelDisplayMode(next);
  return remapClientIaLabelsAndIcons(next);
}

function remapItemsToGroup(
  tree: MenuNode[],
  ids: readonly string[],
  groupId: string,
): MenuNode[] {
  const idSet = new Set(ids);
  const collected = new Map<string, MenuNode>();

  const strip = (nodes: MenuNode[], inTarget: boolean): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item" && idSet.has(node.id)) {
        if (inTarget) return [node];
        collected.set(node.id, node);
        return [];
      }
      if (!node.children?.length) return [node];
      const children = strip(node.children, node.id === groupId);
      if (children.length === 0 && !node.id.startsWith("group-custom-")) return [];
      return [{ ...node, children }];
    });

  let next = strip(tree, false);
  if (collected.size === 0) return next;

  let groupIdx = next.findIndex((node) => node.id === groupId);
  if (groupIdx < 0) {
    next = [...next, { ...groupNodeFor(groupId), children: [] }];
    groupIdx = next.length - 1;
  }
  const group = next[groupIdx];
  const children = [...(group.children ?? [])];
  for (const id of ids) {
    const item = collected.get(id);
    if (item && !children.some((child) => child.id === id)) children.push(item);
  }
  const patched = [...next];
  patched[groupIdx] = { ...group, children };
  return patched;
}

function remapClientIaLabelsAndIcons(tree: MenuNode[]): MenuNode[] {
  const walk = (nodes: MenuNode[]): MenuNode[] =>
    nodes.map((node) => {
      const children = node.children ? walk(node.children) : node.children;
      if (node.type === "item" && node.id === "vehicles" && node.icon === "Car") {
        return { ...node, icon: "Truck", children };
      }
      if (node.type === "item" && node.id === "payroll") {
        return {
          ...node,
          label: node.label === "Payroll & Requests" ? "Payroll" : node.label,
          icon: node.icon === "CalendarClock" ? "Banknote" : node.icon,
          children,
        };
      }
      if (node.type === "item" && node.id === "visit-bookings") {
        return {
          ...node,
          label: node.label === "Visit Bookings" ? "Visit Slots" : node.label,
          icon:
            node.icon === "CalendarCheck" || node.icon === "Calendar" ? "Table2" : node.icon,
          children,
        };
      }
      if (node.type === "item" && node.id === "employeedesk-settings") {
        return {
          ...node,
          label: node.label === "Settings" ? "EmployeeDesk settings" : node.label,
          children,
        };
      }
      return children === node.children ? node : { ...node, children };
    });
  return walk(tree);
}

export function resolveForSidebar(
  tree: MenuNode[],
  can: (p: Permission) => boolean,
  isSuperAdmin: boolean,
): ResolvedMenuNode[] {
  const reg = registryMap();

  const resolve = (nodes: MenuNode[], depth: number): ResolvedMenuNode[] => {
    const out: ResolvedMenuNode[] = [];
    for (const n of nodes) {
      if (n.hidden) continue;
      if (n.type === "item") {
        const r = reg.get(n.id);
        if (!r || r.hidden) continue;
        if (r.superAdminOnly && !isSuperAdmin) continue;
        if (r.id === "restaurants") {
          if (!can("restaurants.view") && !can("earnings.view")) continue;
        } else if (r.permissionAnyOf && r.permissionAnyOf.length > 0) {
          if (!r.permissionAnyOf.some((p) => can(p))) continue;
        } else if (r.permission && !can(r.permission)) continue;
        out.push({
          id: n.id,
          type: "item",
          label: n.label,
          icon: n.icon,
          href: r.href,
          permission: r.permission,
          superAdminOnly: r.superAdminOnly,
          footer: r.footer,
        });
      } else {
        const children = depth < 1 ? resolve(n.children || [], depth + 1) : [];
        if (children.length === 0) continue;
        out.push({
          id: n.id,
          type: "group",
          label: n.label,
          icon: n.icon,
          displayMode: n.displayMode,
          children,
        });
      }
    }
    return out;
  };

  return resolve(tree, 0);
}

export function buildInitialTree(
  can: (p: Permission) => boolean,
  isSuperAdmin: boolean,
): ResolvedMenuNode[] {
  const { tree } = mergeMenu([]);
  return resolveForSidebar(tree, can, isSuperAdmin);
}
