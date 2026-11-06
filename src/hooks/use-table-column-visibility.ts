"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadTableColumnState,
  moveId,
  reconcileOrder,
  reorderIds,
  saveTableColumnState,
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
  const optionIds = useMemo(() => options.map((o) => o.id), [options]);
  const optionIdsSignature = optionIds.join("|");
  const lockedSignature = useMemo(
    () => options.filter((o) => o.locked).map((o) => o.id).join("|"),
    [options],
  );
  const lockedIds = useMemo(
    () => new Set(lockedSignature ? lockedSignature.split("|") : []),
    [lockedSignature],
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
  const [columnOrder, setColumnOrder] = useState<string[]>(optionIds);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const knownIds = optionIdsSignature ? optionIdsSignature.split("|") : [];
    const knownLocked = lockedSignature ? lockedSignature.split("|") : [];
    const stored = loadTableColumnState(storageKey);
    const nextOrder = reconcileOrder(stored?.order ?? [], knownIds);
    const nextVisible = new Set<string>(knownLocked);
    if (stored) {
      const knownSet = new Set(knownIds);
      for (const id of stored.visible) {
        if (knownSet.has(id)) nextVisible.add(id);
      }
      for (const id of knownLocked) nextVisible.add(id);
    } else {
      for (const id of knownIds) nextVisible.add(id);
    }
    setColumnOrder((prev) =>
      prev.join("|") === nextOrder.join("|") ? prev : nextOrder,
    );
    setVisibleIds((prev) => {
      const prevSorted = Array.from(prev).sort().join("|");
      const nextSorted = Array.from(nextVisible).sort().join("|");
      return prevSorted === nextSorted ? prev : nextVisible;
    });
    setHydrated(true);
  }, [storageKey, lockedSignature, optionIdsSignature]);

  const persist = useCallback(
    (next: Set<string>, order: string[]) => {
      setVisibleIds(next);
      setColumnOrder(order);
      saveTableColumnState(storageKey, {
        visible: Array.from(next).filter((id) => !lockedIds.has(id)),
        order: order.filter((id) => !lockedIds.has(id)),
      });
    },
    [lockedIds, storageKey],
  );

  const persistVisibility = useCallback(
    (next: Set<string>) => persist(next, columnOrder),
    [columnOrder, persist],
  );

  const isVisible = useCallback((id: string) => visibleIds.has(id), [visibleIds]);

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
      persistVisibility(next);
    },
    [lockedIds, persistVisibility, toggleableIds, visibleIds],
  );

  const toggle = useCallback(
    (id: string) => setVisible(id, !visibleIds.has(id)),
    [setVisible, visibleIds],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const next = moveId(columnOrder, id, dir);
      if (next === columnOrder) return;
      persist(visibleIds, next);
    },
    [columnOrder, persist, visibleIds],
  );

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      const next = reorderIds(columnOrder, activeId, overId);
      if (next === columnOrder) return;
      persist(visibleIds, next);
    },
    [columnOrder, persist, visibleIds],
  );

  const reset = useCallback(() => {
    persist(new Set(defaultVisibleIds), optionIds);
  }, [defaultVisibleIds, optionIds, persist]);

  const orderedOptions = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    return columnOrder
      .map((id) => byId.get(id))
      .filter((o): o is TableColumnVisibilityOption => Boolean(o));
  }, [columnOrder, options]);

  const pickerOptions = useMemo(
    () => orderedOptions.filter((o) => !o.locked),
    [orderedOptions],
  );

  const hiddenToggleableCount = useMemo(
    () => pickerOptions.filter((o) => !visibleIds.has(o.id)).length,
    [pickerOptions, visibleIds],
  );

  /** Every visible column id (locked included) in the operator's saved order. */
  const orderedVisibleColumnIds = useMemo(
    () => columnOrder.filter((id) => visibleIds.has(id)),
    [columnOrder, visibleIds],
  );

  return {
    hydrated,
    isVisible,
    toggle,
    setVisible,
    reset,
    move,
    reorder,
    pickerOptions,
    orderedPickerOptions: pickerOptions,
    columnOrder,
    orderedVisibleColumnIds,
    hiddenToggleableCount,
  };
}
