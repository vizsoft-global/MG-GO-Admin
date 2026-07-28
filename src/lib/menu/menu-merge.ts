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
  return { tree: pruned, unassignedIds: unassigned };
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
