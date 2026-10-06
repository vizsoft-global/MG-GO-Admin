import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { APP_REGISTRY, type AppDefinition, type AppId } from "./apps";
import type { ResolvedMenuNode } from "./menu-merge";

const UNSCOPED_PREFIXES = ["/dashboard", "/assistant", "/unauthorized", "/apps"];

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function deriveActiveApp(pathname: string): AppId | null {
  const path = pathname.replace(/^\/(en|ar)(?=\/|$)/, "") || "/";
  if (UNSCOPED_PREFIXES.some((prefix) => pathMatches(path, prefix))) return null;
  for (const app of APP_REGISTRY) {
    if (app.prefixes.some((prefix) => pathMatches(path, prefix))) return app.id;
  }
  return null;
}

export function appById(id: AppId): AppDefinition | undefined {
  return APP_REGISTRY.find((app) => app.id === id);
}

export function visibleApps(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): AppDefinition[] {
  return APP_REGISTRY.filter((app) =>
    app.permissionAnyOf.some((slug: Permission) =>
      hasPermissionInSet(permissions, slug, isSuperAdmin),
    ),
  );
}

function itemMatchesApp(node: ResolvedMenuNode, app: AppDefinition): boolean {
  if (node.type === "item") {
    const href = node.href ?? "";
    return app.prefixes.some((prefix) => pathMatches(href, prefix));
  }
  if (app.groups.includes(node.label)) return true;
  return (node.children ?? []).some((child) => itemMatchesApp(child, app));
}

function filterNode(node: ResolvedMenuNode, app: AppDefinition): ResolvedMenuNode | null {
  if (node.type === "item") {
    return itemMatchesApp(node, app) ? node : null;
  }
  if (app.groups.includes(node.label)) {
    const children = (node.children ?? [])
      .map((child) => filterNode(child, app))
      .filter((child): child is ResolvedMenuNode => child != null);
    if (children.length === 0) return null;
    return { ...node, children };
  }
  const children = (node.children ?? [])
    .map((child) => filterNode(child, app))
    .filter((child): child is ResolvedMenuNode => child != null);
  if (children.length === 0) return null;
  return { ...node, children };
}

/** Keep only the groups/items that belong to the app the operator is inside. */
export function scopeSidebar(
  tree: ResolvedMenuNode[],
  pathname: string,
): { appId: AppId | null; nodes: ResolvedMenuNode[] } {
  const appId = deriveActiveApp(pathname);
  if (!appId) return { appId: null, nodes: tree };
  const app = appById(appId);
  if (!app) return { appId: null, nodes: tree };
  return {
    appId,
    nodes: tree
      .map((node) => filterNode(node, app))
      .filter((node): node is ResolvedMenuNode => node != null),
  };
}
