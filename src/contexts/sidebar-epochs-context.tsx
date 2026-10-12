"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SidebarEpochs = {
  access: number;
  menu: number;
};

const SidebarEpochsContext = createContext<SidebarEpochs>({ access: 0, menu: 0 });

export function SidebarEpochsProvider({
  access,
  menu,
  children,
}: SidebarEpochs & { children: ReactNode }) {
  return (
    <SidebarEpochsContext.Provider value={{ access, menu }}>{children}</SidebarEpochsContext.Provider>
  );
}

export function useSidebarEpochs(): SidebarEpochs {
  return useContext(SidebarEpochsContext);
}
