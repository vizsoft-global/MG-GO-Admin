import type { ResolvedMenuNode } from "@/lib/menu/menu-merge";

/** Full-width pages under an inline group that should not show the secondary nav. */
export const PATHS_WITHOUT_INLINE_SECONDARY_NAV = ["/settings/roles"] as const;

function pathnameUsesFullWidthWithoutSecondaryNav(pathname: string): boolean {
  return PATHS_WITHOUT_INLINE_SECONDARY_NAV.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** First navigable child href for an inline group row in the main sidebar. */
export function firstChildHref(group: ResolvedMenuNode): string | null {
  for (const child of group.children ?? []) {
    if (child.href) return child.href;
  }
  return null;
}

/** True when pathname is under any child of this inline group. */
export function pathnameMatchesInlineGroup(
  group: ResolvedMenuNode,
  pathname: string,
): boolean {
  for (const child of group.children ?? []) {
    if (!child.href) continue;
    if (pathname === child.href || pathname.startsWith(`${child.href}/`)) {
      return true;
    }
  }
  return false;
}

function flattenLeafItems(tree: ResolvedMenuNode[]): ResolvedMenuNode[] {
  const out: ResolvedMenuNode[] = [];
  for (const n of tree) {
    if (n.type === "item" && n.href) out.push(n);
    if (n.type === "group" && n.children) {
      out.push(...flattenLeafItems(n.children));
    }
  }
  return out;
}

/** Longest matching href wins — avoids double-active when `/settings` is a prefix of `/settings/menu-editor`. */
export function findActiveLeafId(
  tree: ResolvedMenuNode[],
  pathname: string,
): string | null {
  let bestId: string | null = null;
  let bestLen = -1;
  for (const item of flattenLeafItems(tree)) {
    const href = item.href!;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (href.length > bestLen) {
        bestLen = href.length;
        bestId = item.id;
      }
    }
  }
  return bestId;
}

export function groupContainsLeaf(
  group: ResolvedMenuNode,
  leafId: string | null,
): boolean {
  if (!leafId) return false;
  function walk(nodes: ResolvedMenuNode[]): boolean {
    for (const n of nodes) {
      if (n.id === leafId) return true;
      if (n.children && walk(n.children)) return true;
    }
    return false;
  }
  return walk(group.children ?? []);
}

export function findInlineGroupForPath(
  tree: ResolvedMenuNode[],
  pathname: string,
): ResolvedMenuNode | null {
  if (pathnameUsesFullWidthWithoutSecondaryNav(pathname)) {
    return null;
  }
  const activeLeafId = findActiveLeafId(tree, pathname);
  for (const node of tree) {
    if (node.type !== "group" || node.displayMode !== "inline") continue;
    if (groupContainsLeaf(node, activeLeafId)) return node;
  }
  return null;
}
