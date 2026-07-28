"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MenuNode } from "@/services/menu-config-service";

const SidebarMenuConfigContext = createContext<MenuNode[]>([]);

export function SidebarMenuConfigProvider({
  config,
  children,
}: {
  config: MenuNode[];
  children: ReactNode;
}) {
  return (
    <SidebarMenuConfigContext.Provider value={config}>
      {children}
    </SidebarMenuConfigContext.Provider>
  );
}

export function useInitialMenuConfig() {
  return useContext(SidebarMenuConfigContext);
}
