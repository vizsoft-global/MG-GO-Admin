"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canMoveColumn,
  columnLayoutKey,
  defaultColumnLayout,
  moveColumn,
  parseColumnLayout,
  reorderColumn,
  resolveColumnLayout,
  serializeColumnLayout,
  toggleColumnVisibility,
  type ColumnLayout,
} from "@/lib/ui-preferences/column-layout";
import type { ColumnOrderController } from "@/components/app/column-order-menu";

type Options = {
  /** Columns that cannot be hidden or moved (identity columns). */
  lockedIds?: readonly string[];
  /** Columns shown before the operator arranges anything; defaults to all. */
  defaultVisible?: readonly string[];
};

/**
 * Column order and visibility for one table, saved in `localStorage`.
 *
 * The payroll sheets save theirs on the server; every other table uses this, so
 * a convenience preference costs no round trip and no preference row. The
 * returned controller is the same shape `ColumnOrderMenu` already draws, which
 * is what makes the popover identical everywhere.
 *
 * Storage is read in an effect rather than in `useState`, so the server-rendered
 * markup and the first client render agree — reading the browser during render
 * is what turned a persisted filter into a React #418 hydration mismatch
 * elsewhere on this page tree.
 */
export function useColumnLayout(
  tableId: string,
  columnIds: readonly string[],
  options?: Options,
): ColumnOrderController & { hydrated: boolean } {
  const lockedIds = options?.lockedIds;
  const defaultVisible = options?.defaultVisible;

  const knownIds = useMemo(() => [...columnIds], [columnIds]);
  const base = useMemo(() => {
    const layout = defaultColumnLayout(knownIds);
    if (!defaultVisible || defaultVisible.length === 0) return layout;
    const known = new Set(knownIds);
    const visible = defaultVisible.filter((id) => known.has(id));
    return { order: layout.order, visible: visible.length ? visible : layout.visible };
  }, [defaultVisible, knownIds]);

  const [layout, setLayout] = useState<ColumnLayout>(base);
  const [hydrated, setHydrated] = useState(false);
  /** Set once the operator changes anything, so a late read cannot undo it. */
  const touched = useRef(false);

  useEffect(() => {
    if (touched.current) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(columnLayoutKey(tableId));
    } catch {
      raw = null;
    }
    setLayout(resolveColumnLayout(knownIds, parseColumnLayout(raw) ?? base));
    setHydrated(true);
    // `base` and `knownIds` change identity only when the table itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, knownIds.join("|")]);

  const commit = useCallback(
    (next: ColumnLayout) => {
      touched.current = true;
      setLayout(next);
      try {
        window.localStorage.setItem(columnLayoutKey(tableId), serializeColumnLayout(next));
      } catch {
        // A full or disabled store must not break the table; the layout still
        // applies for this session.
      }
    },
    [tableId],
  );

  const toggle = useCallback(
    (id: string) => commit(toggleColumnVisibility(layout, id)),
    [commit, layout],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => commit(moveColumn(layout, id, dir, lockedIds)),
    [commit, layout, lockedIds],
  );

  const reorder = useCallback(
    (activeId: string, overId: string) =>
      commit(reorderColumn(layout, activeId, overId, lockedIds)),
    [commit, layout, lockedIds],
  );

  const reset = useCallback(() => {
    touched.current = true;
    setLayout(base);
    try {
      window.localStorage.removeItem(columnLayoutKey(tableId));
    } catch {
      // Nothing to undo when the store is unavailable.
    }
  }, [base, tableId]);

  const visibleIds = useMemo(
    () => layout.order.filter((id) => layout.visible.includes(id)),
    [layout],
  );

  return {
    hydrated,
    order: layout.order,
    visibleIds,
    isVisible: (id: string) => layout.visible.includes(id),
    visibleCount: visibleIds.length,
    toggle,
    move,
    reorder,
    reset,
    /** Drawn as a disabled arrow rather than a click that does nothing. */
    lockedIds,
    canMove: (id: string, dir: -1 | 1) => canMoveColumn(layout, id, dir, lockedIds),
  } as ColumnOrderController & { hydrated: boolean };
}
