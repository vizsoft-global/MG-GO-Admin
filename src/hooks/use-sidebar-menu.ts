"use client";

import { useEffect, useMemo } from "react";
import type { MenuNode } from "@/services/menu-config-service";
import type { Permission } from "@/lib/auth/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useInitialMenuConfig } from "@/contexts/sidebar-menu-context";
import { getMenuConfig } from "@/services/menu-config-service";
import {
  buildInitialTree,
  mergeMenu,
  resolveForSidebar,
  type ResolvedMenuNode,
} from "@/lib/menu/menu-merge";

const MENU_CACHE_VERSION = "v12";
const cacheByRole = new Map<string, ResolvedMenuNode[]>();

function menuStorageKey(role: string) {
  return `sidebar-menu-cache:${MENU_CACHE_VERSION}:${role}`;
}

function pruneStaleCaches(currentRole: string) {
  if (typeof window === "undefined") return;
  try {
    const keepKey = menuStorageKey(currentRole);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("sidebar-menu-cache:") && key !== keepKey) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

function saveCachedMenu(role: string, tree: ResolvedMenuNode[]) {
  cacheByRole.set(role, tree);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(menuStorageKey(role), JSON.stringify(tree));
  } catch {
    /* ignore */
  }
}

function resolveMenuTree(
  cfg: MenuNode[],
  can: (p: Permission) => boolean,
  isSuperAdmin: boolean,
) {
  const { tree: merged } = mergeMenu(cfg);
  const resolved = resolveForSidebar(merged, can, isSuperAdmin);
  if (resolved.length === 0) {
    return buildInitialTree(can, isSuperAdmin);
  }
  return resolved;
}

export function useSidebarMenu() {
  const { adminRoleSlug, can, isSuperAdmin, permissions } = useAuth();
  const initialConfig = useInitialMenuConfig();
  const queryClient = useQueryClient();

  const serverTree = useMemo(
    () => resolveMenuTree(initialConfig, can, isSuperAdmin),
    [initialConfig, isSuperAdmin, permissions],
  );

  const { data: tree = serverTree, isLoading: loading } = useQuery({
    queryKey: ["sidebar-menu", adminRoleSlug, isSuperAdmin],
    queryFn: async () => {
      try {
        const cfg = await getMenuConfig(adminRoleSlug);
        const resolved = resolveMenuTree(cfg, can, isSuperAdmin);
        saveCachedMenu(adminRoleSlug, resolved);
        return resolved;
      } catch {
        const fallback = buildInitialTree(can, isSuperAdmin);
        saveCachedMenu(adminRoleSlug, fallback);
        return fallback;
      }
    },
    initialData: serverTree.length > 0 ? serverTree : undefined,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    pruneStaleCaches(adminRoleSlug);
  }, [adminRoleSlug]);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ role?: string }>).detail;
      if (!detail?.role || detail.role === adminRoleSlug) {
        cacheByRole.delete(adminRoleSlug);
        void queryClient.invalidateQueries({
          queryKey: ["sidebar-menu", adminRoleSlug],
        });
      }
    };
    window.addEventListener("menu-config-updated", onUpdate);
    return () => window.removeEventListener("menu-config-updated", onUpdate);
  }, [adminRoleSlug, queryClient]);

  return { tree, loading };
}
