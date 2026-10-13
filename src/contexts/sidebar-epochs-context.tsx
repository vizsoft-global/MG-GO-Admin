"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { EpochCounters } from "@/lib/auth/epoch-cache";
import { applyReturnedEpochs } from "@/lib/menu/apply-returned-epochs";

export type SidebarEpochs = {
  access: number;
  menu: number;
  settings: number;
};

const SidebarEpochsContext = createContext<SidebarEpochs>({ access: 0, menu: 0, settings: 0 });
const ApplySidebarEpochsContext = createContext<
  (returned: Partial<EpochCounters> | null | undefined) => void
>(() => {});

export function SidebarEpochsProvider({
  access,
  menu,
  settings = 0,
  children,
}: {
  access: number;
  menu: number;
  settings?: number;
  children: ReactNode;
}) {
  const [epochs, setEpochs] = useState<SidebarEpochs>({ access, menu, settings });
  const [seen, setSeen] = useState({ access, menu, settings });
  if (seen.access !== access || seen.menu !== menu || seen.settings !== settings) {
    setSeen({ access, menu, settings });
    setEpochs((prev) => applyReturnedEpochs(prev, { access, menu, settings }));
  }

  const applyEpochs = useCallback((returned: Partial<EpochCounters> | null | undefined) => {
    setEpochs((prev) => applyReturnedEpochs(prev, returned));
  }, []);

  return (
    <ApplySidebarEpochsContext.Provider value={applyEpochs}>
      <SidebarEpochsContext.Provider value={epochs}>{children}</SidebarEpochsContext.Provider>
    </ApplySidebarEpochsContext.Provider>
  );
}

export function useSidebarEpochs(): SidebarEpochs {
  return useContext(SidebarEpochsContext);
}

/** Write counters a save action returned, before the persisted layout refetches. */
export function useApplySidebarEpochs(): (
  returned: Partial<EpochCounters> | null | undefined,
) => void {
  return useContext(ApplySidebarEpochsContext);
}
