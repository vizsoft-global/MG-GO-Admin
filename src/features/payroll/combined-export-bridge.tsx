"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

export type CombinedExportBridge = {
  /** The tab hands over its exporter; passing `null` clears it. */
  register: (run: (() => void) | null) => void;
  /** True when a Combined tab was mounted and ran its exporter. */
  run: () => boolean;
};

const CombinedExportContext = createContext<CombinedExportBridge | null>(null);

/**
 * The page shell owns the bridge so its header button can call `run()`; the
 * Combined tab registers the exporter. Without it the header would write the
 * shared CSV, which disagrees with the columns and colours on screen.
 */
export function useCombinedExportBridgeValue(): CombinedExportBridge {
  const handler = useRef<(() => void) | null>(null);
  const register = useCallback((run: (() => void) | null) => {
    handler.current = run;
  }, []);
  const run = useCallback(() => {
    const next = handler.current;
    if (!next) return false;
    next();
    return true;
  }, []);
  return useMemo<CombinedExportBridge>(() => ({ register, run }), [register, run]);
}

export function CombinedExportBridgeProvider({
  value,
  children,
}: {
  value: CombinedExportBridge;
  children: ReactNode;
}) {
  return <CombinedExportContext.Provider value={value}>{children}</CombinedExportContext.Provider>;
}

export function useCombinedExportBridge(): CombinedExportBridge | null {
  return useContext(CombinedExportContext);
}

