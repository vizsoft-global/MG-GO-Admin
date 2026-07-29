"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearUserUiPreference,
  getEffectiveUiPreference,
  saveUserUiPreference,
} from "@/features/settings/ui-preferences-actions";
import type { TableColumnVisibilityOption } from "@/hooks/use-table-column-visibility";
import { loadTableColumnVisibility } from "@/lib/table-column-visibility";
import { queryKeys } from "@/lib/query/query-keys";
import {
  DRIVERS_LIST_COLUMNS_PREF_KEY,
  type ListColumnPreference,
} from "@/lib/ui-preferences/types";

const LOCAL_KEY = "dpd:drivers:list-columns";
const MIGRATED_FLAG = "dpd:drivers:list-columns:migrated";

function systemDefault(
  options: TableColumnVisibilityOption[],
): ListColumnPreference {
  const order = options.map((o) => o.id);
  const visible = options
    .filter((o) => o.locked || o.defaultVisible !== false)
    .map((o) => o.id);
  return { order, visible, sort: null };
}

export function useDriversListColumns(options: TableColumnVisibilityOption[]) {
  const qc = useQueryClient();
  const knownIds = useMemo(() => options.map((o) => o.id), [options]);
  const system = useMemo(() => systemDefault(options), [options]);
  const lockedIds = useMemo(
    () => new Set(options.filter((o) => o.locked).map((o) => o.id)),
    [options],
  );

  const prefQuery = useQuery({
    queryKey: queryKeys.uiPreferences.effective(DRIVERS_LIST_COLUMNS_PREF_KEY),
    queryFn: () =>
      getEffectiveUiPreference(DRIVERS_LIST_COLUMNS_PREF_KEY, knownIds, system),
    staleTime: 30_000,
  });

  const [localOverride, setLocalOverride] = useState<ListColumnPreference | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(MIGRATED_FLAG)) return;
    if (prefQuery.data?.userOverride) {
      localStorage.setItem(MIGRATED_FLAG, "1");
      return;
    }
    const stored = loadTableColumnVisibility(LOCAL_KEY);
    if (!stored?.length) {
      localStorage.setItem(MIGRATED_FLAG, "1");
      return;
    }
    const migrated: ListColumnPreference = {
      order: knownIds,
      visible: [...new Set([...stored, ...lockedIds])],
      sort: null,
    };
    void saveUserUiPreference(DRIVERS_LIST_COLUMNS_PREF_KEY, migrated).then(() => {
      localStorage.setItem(MIGRATED_FLAG, "1");
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(DRIVERS_LIST_COLUMNS_PREF_KEY),
      });
    });
  }, [prefQuery.data?.userOverride, knownIds, lockedIds, qc]);

  const effective = localOverride ?? prefQuery.data?.effective ?? system;
  const source = localOverride ? "user" : (prefQuery.data?.source ?? "system");

  const orderedOptions = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    const ordered = [
      ...effective.order.filter((id) => byId.has(id)),
      ...options.map((o) => o.id).filter((id) => !effective.order.includes(id)),
    ]
      .map((id) => byId.get(id)!)
      .filter(Boolean);
    return ordered;
  }, [options, effective.order]);

  const visibleSet = useMemo(() => {
    const next = new Set(effective.visible);
    for (const id of lockedIds) next.add(id);
    return next;
  }, [effective.visible, lockedIds]);

  const persist = useMutation({
    mutationFn: (value: ListColumnPreference) =>
      saveUserUiPreference(DRIVERS_LIST_COLUMNS_PREF_KEY, value),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(DRIVERS_LIST_COLUMNS_PREF_KEY),
      });
    },
  });

  const clearOverride = useMutation({
    mutationFn: () => clearUserUiPreference(DRIVERS_LIST_COLUMNS_PREF_KEY),
    onSuccess: () => {
      setLocalOverride(null);
      void qc.invalidateQueries({
        queryKey: queryKeys.uiPreferences.effective(DRIVERS_LIST_COLUMNS_PREF_KEY),
      });
    },
  });

  const isVisible = useCallback((id: string) => visibleSet.has(id), [visibleSet]);

  const applyNext = useCallback(
    (next: ListColumnPreference) => {
      setLocalOverride(next);
      persist.mutate(next);
    },
    [persist],
  );

  const toggle = useCallback(
    (id: string) => {
      if (lockedIds.has(id)) return;
      const nextVisible = new Set(visibleSet);
      if (nextVisible.has(id)) {
        const toggleable = orderedOptions.filter((o) => !o.locked).map((o) => o.id);
        const visibleToggleable = toggleable.filter((tid) => nextVisible.has(tid));
        if (visibleToggleable.length <= 1) return;
        nextVisible.delete(id);
      } else {
        nextVisible.add(id);
      }
      applyNext({
        order: orderedOptions.map((o) => o.id),
        visible: Array.from(nextVisible),
        sort: effective.sort,
      });
    },
    [lockedIds, visibleSet, orderedOptions, applyNext, effective.sort],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      const ids = orderedOptions.map((o) => o.id);
      const idx = ids.indexOf(id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= ids.length) return;
      const next = [...ids];
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      applyNext({
        order: next,
        visible: Array.from(visibleSet),
        sort: effective.sort,
      });
    },
    [orderedOptions, applyNext, visibleSet, effective.sort],
  );

  const resetToRoleDefault = useCallback(() => {
    clearOverride.mutate();
  }, [clearOverride]);

  const pickerOptions = useMemo(
    () => orderedOptions.filter((o) => !o.locked),
    [orderedOptions],
  );

  const hiddenToggleableCount = useMemo(
    () => pickerOptions.filter((o) => !visibleSet.has(o.id)).length,
    [pickerOptions, visibleSet],
  );

  return {
    isVisible,
    toggle,
    move,
    resetToRoleDefault,
    pickerOptions,
    orderedVisibleIds: orderedOptions
      .map((o) => o.id)
      .filter((id) => visibleSet.has(id)),
    hiddenToggleableCount,
    source,
    hydrated: prefQuery.isFetched,
  };
}
