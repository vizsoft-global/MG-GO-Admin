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
      relocateOrderReconItem(
        relocatePayrollItem(relocateAssistantItem(stripFleetSidebar(pruned))),
      ),
    ),
    unassignedIds: unassigned,
  };
}

const FLEET_GROUP_ID = "group-fleet";
const FLEET_SIDEBAR_IDS = new Set([
  "vehicles",
  "fuel",
  "fuel-requests",
  "fuel-refunds",
  "assets",
  "asset-requests",
]);

function stripFleetSidebar(tree: MenuNode[]): MenuNode[] {
  const strip = (nodes: MenuNode[]): MenuNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "item") {
        return FLEET_SIDEBAR_IDS.has(node.id) ? [] : [node];
      }
      if (node.id === FLEET_GROUP_ID) return [];
      const children = node.children ? strip(node.children) : [];
      if (children.length === 0) return [];
      return [{ ...node, children }];
    });
  return strip(tree);
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
  const perfIdx = children.findIndex((child) => child.id === "performance");
  children.splice(perfIdx >= 0 ? perfIdx + 1 : children.length, 0, item);
  const next = [...stripped];
  next[opsIdx] = { ...ops, children };
  return next;
}

function relocatePayrollItem(tree: MenuNode[]): MenuNode[] {
  const PAYROLL_ID = "payroll";
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
        type: "group",
        label: "Operations",
        icon: "Folder",
        children: [item],
      },
    ];
  }

  const ops = stripped[opsIdx];
  const children = [...(ops.children ?? [])].filter((child) => child.id !== PAYROLL_ID);
  const assistantIdx = children.findIndex((child) => child.id === "assistant");
  const perfIdx = children.findIndex((child) => child.id === "performance");
  const insertAt =
    assistantIdx >= 0 ? assistantIdx + 1 : perfIdx >= 0 ? perfIdx + 1 : children.length;
  children.splice(insertAt, 0, item);
  const next = [...stripped];
  next[opsIdx] = { ...ops, children };
  return next;
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
