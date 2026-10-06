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

/**
 * SUPERSEDED: the reference sidebar is the full flat list on every page.
 * Kept so saved callers compile; it never filters.
 */
export function scopeSidebar(
  tree: ResolvedMenuNode[],
  _pathname: string,
): { appId: AppId | null; nodes: ResolvedMenuNode[] } {
  return { appId: null, nodes: tree };
}
