"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadTableColumnVisibility,
  saveTableColumnVisibility,
} from "@/lib/table-column-visibility";

export type TableColumnVisibilityOption = {
  id: string;
  label: string;
  /** Always shown; excluded from the column picker */
  locked?: boolean;
  /** Defaults to true when omitted */
  defaultVisible?: boolean;
};

function buildDefaultVisibleSet(options: TableColumnVisibilityOption[]) {
  return new Set(
    options
      .filter((o) => o.locked || o.defaultVisible !== false)
      .map((o) => o.id),
  );
}

export function useTableColumnVisibility(
  storageKey: string,
  options: TableColumnVisibilityOption[],
) {
  const lockedIds = useMemo(
    () => new Set(options.filter((o) => o.locked).map((o) => o.id)),
    [options],
  );
  const toggleableIds = useMemo(
    () => options.filter((o) => !o.locked).map((o) => o.id),
    [options],
  );
  const defaultVisibleIds = useMemo(
    () => buildDefaultVisibleSet(options),
    [options],
  );

  const [visibleIds, setVisibleIds] = useState(defaultVisibleIds);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadTableColumnVisibility(storageKey);
    if (stored) {
      const next = new Set<string>(lockedIds);
      for (const id of stored) {
        if (options.some((o) => o.id === id)) next.add(id);
      }
      for (const id of lockedIds) next.add(id);
      setVisibleIds(next);
    }
    setHydrated(true);
  }, [storageKey, lockedIds, options]);

  const persist = useCallback(
    (next: Set<string>) => {
      setVisibleIds(next);
      const toStore = Array.from(next).filter((id) => !lockedIds.has(id));
      saveTableColumnVisibility(storageKey, toStore);
    },
    [lockedIds, storageKey],
  );

  const isVisible = useCallback(
    (id: string) => visibleIds.has(id),
    [visibleIds],
  );

  const setVisible = useCallback(
    (id: string, visible: boolean) => {
      if (lockedIds.has(id)) return;
      const next = new Set(visibleIds);
      if (visible) {
        next.add(id);
      } else {
        const visibleToggleable = toggleableIds.filter((tid) => next.has(tid));
        if (visibleToggleable.length <= 1 && visibleToggleable[0] === id) {
          return;
        }
        next.delete(id);
      }
      persist(next);
    },
    [lockedIds, persist, toggleableIds, visibleIds],
  );

  const toggle = useCallback(
    (id: string) => setVisible(id, !visibleIds.has(id)),
    [setVisible, visibleIds],
  );

  const reset = useCallback(() => {
    persist(new Set(defaultVisibleIds));
  }, [defaultVisibleIds, persist]);

  const pickerOptions = useMemo(
    () => options.filter((o) => !o.locked),
    [options],
  );

  const hiddenToggleableCount = useMemo(
    () => pickerOptions.filter((o) => !visibleIds.has(o.id)).length,
    [pickerOptions, visibleIds],
  );

  return {
    hydrated,
    isVisible,
    toggle,
    setVisible,
    reset,
    pickerOptions,
    hiddenToggleableCount,
  };
}
