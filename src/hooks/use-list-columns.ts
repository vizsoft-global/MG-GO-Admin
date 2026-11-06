"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearUserUiPreference,
  getEffectiveUiPreference,
  saveUserUiPreference,
} from "@/features/settings/ui-preferences-actions";
import { queryKeys } from "@/lib/query/query-keys";
import {
  dropColumnInOrder,
  mergeColumnOrder,
  moveColumnInOrder,
} from "@/lib/table-column-order";
import type { ListColumnPreference } from "@/lib/ui-preferences/types";

/**
 * Column order and visibility for one table, saved per staff member in
 * `admin_ui_preferences` under `preferenceKey`.
 *
 * The same controller backs every payroll sheet's "Show and reorder columns"
 * menu, so the arrows, the drag handle and the checkboxes behave identically
 * wherever they appear. `columnIds` is the catalogue in its canonical order;
 * ids saved by an older build are reconciled against it, and a column added
 * later appears with the rest instead of staying hidden.
 */
export function useListColumns(
  preferenceKey: string,
  columnIds: readonly string[],
  options?: {
    /** Columns shown before the operator saves a choice; defaults to all of them. */
    defaultVisible?: readonly string[];
  },
) {
  const qc = useQueryClient();
  const knownIds = useMemo(() => [...columnIds], [columnIds]);
  const defaultVisibleIds = options?.defaultVisible;
  const system = useMemo<ListColumnPreference>(() => {
    const known = new Set(knownIds);
    const visible = (defaultVisibleIds ?? knownIds).filter((id) => known.has(id));
    return {
      order: [...knownIds],
      visible: visible.length > 0 ? [...visible] : [...knownIds],
      sort: null,
    };
  }, [defaultVisibleIds, knownIds]);

  const prefQuery = useQuery({
    queryKey: queryKeys.uiPreferences.effective(preferenceKey),
    queryFn: () => getEffectiveUiPreference(preferenceKey, knownIds, system),
    staleTime: 30_000,
  });

  const [localOverride, setLocalOverride] = useState<ListColumnPreference | null>(null);

  const effective = localOverride ?? prefQuery.data?.effective ?? system;
  const order = useMemo(
    () => mergeColumnOrder(knownIds, effective.order),
    [knownIds, effective.order],
  );
  const visible = useMemo(() => {
    const known = new Set(knownIds);
    const saved = effective.visible.filter((id) => known.has(id));
    return new Set(saved.length > 0 ? saved : knownIds);
  }, [knownIds, effective.visible]);

  const persist = useMutation({
    mutationFn: (value: ListColumnPreference) => saveUserUiPreference(preferenceKey, value),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(preferenceKey),
      });
    },
  });

  const clearOverride = useMutation({
    mutationFn: () => clearUserUiPreference(preferenceKey),
    onSuccess: () => {
      setLocalOverride(null);
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(preferenceKey),
      });
    },
  });

  const applyNext = useCallback(
    (nextOrder: readonly string[], nextVisible: ReadonlySet<string>) => {
      const value: ListColumnPreference = {
        order: [...nextOrder],
        visible: nextOrder.filter((id) => nextVisible.has(id)),
        sort: null,
      };
      setLocalOverride(value);
      persist.mutate(value);
    },
    [persist],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(visible);
      if (next.has(id)) {
        if (next.size <= 1) return;
        next.delete(id);
      } else {
        next.add(id);
      }
      applyNext(order, next);
    },
    [applyNext, order, visible],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const next = moveColumnInOrder(order, id, dir);
      if (next.join("|") === order.join("|")) return;
      applyNext(next, visible);
    },
    [applyNext, order, visible],
  );

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      const next = dropColumnInOrder(order, activeId, overId);
      if (next.join("|") === order.join("|")) return;
      applyNext(next, visible);
    },
    [applyNext, order, visible],
  );

  const reset = useCallback(() => {
    setLocalOverride(null);
    clearOverride.mutate();
  }, [clearOverride]);

  const visibleIds = useMemo(() => order.filter((id) => visible.has(id)), [order, visible]);

  return {
    hydrated: prefQuery.isFetched,
    order,
    visibleIds,
    isVisible: (id: string) => visible.has(id),
    visibleCount: visibleIds.length,
    toggle,
    move,
    reorder,
    reset,
  };
}

export type ListColumnsController = ReturnType<typeof useListColumns>;
