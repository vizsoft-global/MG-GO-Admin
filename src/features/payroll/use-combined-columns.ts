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
  PAYROLL_COMBINED_COLUMNS_PREF_KEY,
  type ListColumnPreference,
} from "@/lib/ui-preferences/types";
import { COMBINED_COLUMN_ORDER, normalizeCombinedColumns } from "./combined-columns";

function systemDefault(): ListColumnPreference {
  return { order: [...COMBINED_COLUMN_ORDER], visible: [...COMBINED_COLUMN_ORDER], sort: null };
}

/**
 * The Combined Payroll column order and visibility, saved per staff member in
 * `admin_ui_preferences` under `payroll.combined`.
 *
 * `days` is one id, so the 31 day columns move and hide as a block. The pinned
 * trio never enters the preference — it is always drawn on the start edge.
 */
export function useCombinedColumns() {
  const qc = useQueryClient();
  const knownIds = useMemo(() => [...COMBINED_COLUMN_ORDER], []);
  const system = useMemo(() => systemDefault(), []);

  const prefQuery = useQuery({
    queryKey: queryKeys.uiPreferences.effective(PAYROLL_COMBINED_COLUMNS_PREF_KEY),
    queryFn: () =>
      getEffectiveUiPreference(PAYROLL_COMBINED_COLUMNS_PREF_KEY, knownIds, system),
    staleTime: 30_000,
  });

  const [localOverride, setLocalOverride] = useState<ListColumnPreference | null>(null);

  const effective = localOverride ?? prefQuery.data?.effective ?? system;
  const { order, visible } = useMemo(
    () => normalizeCombinedColumns(effective.order, effective.visible),
    [effective.order, effective.visible],
  );

  const persist = useMutation({
    mutationFn: (value: ListColumnPreference) =>
      saveUserUiPreference(PAYROLL_COMBINED_COLUMNS_PREF_KEY, value),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(PAYROLL_COMBINED_COLUMNS_PREF_KEY),
      });
    },
  });

  const clearOverride = useMutation({
    mutationFn: () => clearUserUiPreference(PAYROLL_COMBINED_COLUMNS_PREF_KEY),
    onSuccess: () => {
      setLocalOverride(null);
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(PAYROLL_COMBINED_COLUMNS_PREF_KEY),
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
      const index = order.indexOf(id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= order.length) return;
      const next = [...order];
      const swapped = next[index]!;
      next[index] = next[target]!;
      next[target] = swapped;
      applyNext(next, visible);
    },
    [applyNext, order, visible],
  );

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      const from = order.indexOf(activeId);
      const to = order.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...order];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
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

export type CombinedColumnsController = ReturnType<typeof useCombinedColumns>;
