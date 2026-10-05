import {
  DEFAULT_GROUPS,
  DEFAULT_GROUP_META,
  MENU_REGISTRY,
  OPERATIONS_HUB_GROUP,
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
  registryIds.forEach((id) => {
    if (!existing.has(id)) unassigned.push(id);
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
    const newChildren = unassigned.map((id) => {
      const r = reg.get(id)!;
      return {
        id,
        type: "item" as const,
        label: r.defaultLabel,
        icon: r.defaultIcon,
        hidden: false,
      };
    });
    const idx = pruned.findIndex(
      (n) => n.id === "group-unorganised" || n.id === "group-unassigned",
    );
    if (idx >= 0) {
      pruned[idx] = {
        ...pruned[idx],
        id: "group-unorganised",
        label: "Unorganised",
        children: [...(pruned[idx].children || []), ...newChildren],
      };
    } else {
      pruned.push({
        id: "group-unorganised",
        type: "group",
        label: "Unorganised",
        icon: "Folder",
        children: newChildren,
      });
    }
  }
  return {
    tree: relocateStaffAccessItem(
      relocateSettingsSplit(
        relocateOrderReconItem(
          relocatePayrollItem(
            relocateAssistantItem(relocateFleetItems(relocateOperationsHubItems(pruned))),
          ),
        ),
      ),
    ),
    unassignedIds: unassigned,
  };
}

const FLEET_GROUP_ID = "group-fleet";

function relocateFleetItems(tree: MenuNode[]): MenuNode[] {
  const fleetIds = new Set(
    MENU_REGISTRY.filter((item) => item.defaultGroup === "Fleet").map((item) => item.id),
  );
  const collected = new Map<string, MenuNode>();

  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (fleetIds.has(node.id)) {
          collected.set(node.id, node);
          return [];
        }
        return [node];
      }
      if (node.id === FLEET_GROUP_ID) {
        for (const child of node.children ?? []) {
          if (child.type === "item") collected.set(child.id, child);
        }
        return [];
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const children = MENU_REGISTRY.filter((item) => item.defaultGroup === "Fleet")
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((item) => {
      const existing = collected.get(item.id);
      return {
        id: item.id,
        type: "item" as const,
        label: item.defaultLabel,
        icon: existing?.icon ?? item.defaultIcon,
        hidden: false,
      };
    });

  if (children.length === 0) {
    return stripped.filter((node) => node.type === "item" || (node.children?.length ?? 0) > 0);
  }

  const fleetGroup: MenuNode = {
    id: FLEET_GROUP_ID,
    type: "group",
    label: "Fleet",
    icon: DEFAULT_GROUP_META.Fleet?.icon ?? "Car",
    displayMode: DEFAULT_GROUP_META.Fleet?.displayMode,
    children,
  };

  const overviewIdx = stripped.findIndex((node) => node.id === "group-overview");
  const next = [...stripped];
  next.splice(overviewIdx >= 0 ? overviewIdx + 1 : 0, 0, fleetGroup);
  return next.filter((node) => node.type === "item" || (node.children?.length ?? 0) > 0);
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

  const opsIdx = stripped.findIndex((node) => node.id === "group-operations");
  if (opsIdx < 0) {
    return [
      ...stripped,
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [item],
      },
    ];
  }

  const ops = stripped[opsIdx];
  const children = [...(ops.children ?? [])].filter((child) => child.id !== ASSISTANT_ID);
  const payrollIdx = children.findIndex((child) => child.id === "payroll");
  const perfIdx = children.findIndex((child) => child.id === "performance");
  const insertAt =
    payrollIdx >= 0 ? payrollIdx + 1 : perfIdx >= 0 ? perfIdx + 1 : children.length;
  children.splice(insertAt, 0, item);
  const next = [...stripped];
  next[opsIdx] = { ...ops, children };
  return next;
}

function relocatePayrollItem(tree: MenuNode[]): MenuNode[] {
  const PAYROLL_ID = "payroll";
  const GROUP_ID = "group-payroll";
  let found: MenuNode | null = null;
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === PAYROLL_ID) {
          found = { ...node, hidden: false };
          return [];
        }
        return [node];
      }
      if (node.id === GROUP_ID) {
        for (const child of node.children ?? []) {
          if (child.id === PAYROLL_ID) found = { ...child, hidden: false };
        }
        return [];
      }
      const children = node.children ? strip(node.children) : [];
      return [{ ...node, children }];
    });

  const stripped = strip(tree);
  const item: MenuNode = found ?? {
    id: PAYROLL_ID,
    type: "item",
    label: "Payroll & Requests",
    icon: "CalendarClock",
    hidden: false,
  };

  const opsIdx = stripped.findIndex((node) => node.id === "group-operations");
  if (opsIdx < 0) {
    return [
      ...stripped,
      {
        id: "group-operations",
        type: "group" as const,
        label: "Operations",
        icon: "Folder",
        children: [item],
      },
    ];
  }

  const ops = stripped[opsIdx];
  const children = [...(ops.children ?? [])].filter((child) => child.id !== PAYROLL_ID);
  const perfIdx = children.findIndex((child) => child.id === "performance");
  children.splice(perfIdx >= 0 ? perfIdx + 1 : children.length, 0, item);
  const next = [...stripped];
  next[opsIdx] = { ...ops, children };
  return next.filter((node) => node.type === "item" || (node.children?.length ?? 0) > 0);
}

function relocateOrderReconItem(tree: MenuNode[]): MenuNode[] {
  const RECON_ID = "order-reconciliation";
  let found: MenuNode | null = null;
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === RECON_ID) {
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
    id: RECON_ID,
    type: "item",
    label: "Order reconciliation",
    icon: "GitCompareArrows",
    hidden: false,
  };

  const opsIdx = stripped.findIndex((node) => node.id === "group-operations");
  if (opsIdx < 0) {
    return [
      ...stripped,
      {
        id: "group-operations",
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [item],
      },
    ];
  }

  const ops = stripped[opsIdx];
  const children = [...(ops.children ?? [])].filter((child) => child.id !== RECON_ID);
  const deliveriesIdx = children.findIndex((child) => child.id === "deliveries");
  children.splice(deliveriesIdx >= 0 ? deliveriesIdx + 1 : children.length, 0, item);
  const next = [...stripped];
  next[opsIdx] = { ...ops, children };
  return next;
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
  { id: "storage", group: SYSTEM_GROUP_ID },
  { id: "maintenance", group: SYSTEM_GROUP_ID },
  { id: "languages", group: SYSTEM_GROUP_ID },
  { id: "data-cleanup", group: SYSTEM_GROUP_ID },
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
 * and `attendance-settings` living inside `group-settings`, and `vehicle-types`,
 * `vehicle-uses` and `source-companies` inside `group-fleet`.
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
  "vehicle-types",
  "vehicle-uses",
  "source-companies",
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
  const children = OPERATIONS_HUB_IDS.filter((id) => collected.has(id)).map((id) => {
    const existing = collected.get(id)!;
    // The hub itself is a nav entry the operations team depends on, so it is
    // never left hidden — matching how Fleet is pinned.
    return id === "operations-hub" ? { ...existing, hidden: false } : existing;
  });

  if (children.length === 0) return stripped;

  const meta = DEFAULT_GROUP_META.OperationsHub;
  const hub: MenuNode = {
    id: OPERATIONS_HUB_GROUP_ID,
    type: "group",
    label: "OperationsHub",
    icon: meta?.icon ?? "Building2",
    displayMode: meta?.displayMode,
    children,
  };

  // Placed by its DEFAULT_GROUPS rank, so it lands beside EmployeeDesk whichever
  // of its neighbours happen to exist in this tenant's tree.
  const hubRank = DEFAULT_GROUPS.indexOf("OperationsHub");
  let insertAt = 0;
  stripped.forEach((node, index) => {
    const label = DEFAULT_GROUPS.find((g) => `group-${g.toLowerCase()}` === node.id);
    if (label && DEFAULT_GROUPS.indexOf(label) < hubRank) insertAt = index + 1;
  });

  const next = [...stripped];
  next.splice(insertAt, 0, hub);
  return next.filter((node) => node.type === "item" || (node.children?.length ?? 0) > 0);
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

function relocateStaffAccessItem(tree: MenuNode[]): MenuNode[] {
  const STAFF_ACCESS_ID = "staff-access";
  let found: MenuNode | null = null;
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        if (node.id === STAFF_ACCESS_ID) {
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
    id: STAFF_ACCESS_ID,
    type: "item",
    label: "Staff access",
    icon: "KeyRound",
    hidden: false,
  };

  const settingsIdx = stripped.findIndex((node) => node.id === "group-settings");
  if (settingsIdx < 0) {
    return [
      ...stripped,
      {
        id: "group-settings",
        type: "group",
        label: "Settings",
        icon: "Settings",
        children: [item],
      },
    ];
  }

  const settings = stripped[settingsIdx];
  const children = [...(settings.children ?? [])].filter((child) => child.id !== STAFF_ACCESS_ID);
  const rolesIdx = children.findIndex((child) => child.id === "roles");
  children.splice(rolesIdx >= 0 ? rolesIdx + 1 : children.length, 0, item);
  const next = [...stripped];
  next[settingsIdx] = { ...settings, children };
  return next;
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
        if (!r) continue;
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
