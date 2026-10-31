"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getEffectiveUiPreference,
  saveUserUiPreference,
} from "@/features/settings/ui-preferences-actions";
import type { ListColumnPreference } from "@/lib/ui-preferences/types";
import type { TableToolbarColumn, TableViewMode } from "./toolbar-config";

const NONE = "none";

function systemPreference(columns: TableToolbarColumn[]): ListColumnPreference {
  return {
    order: columns.map((column) => column.id),
    visible: columns.filter((column) => !column.defaultHidden).map((column) => column.id),
    sort: null,
    groupBy: NONE,
    viewMode: "list",
  };
}

function reorderIds(order: string[], activeId: string, overId: string): string[] {
  const next = [...order];
  const from = next.indexOf(activeId);
  const to = next.indexOf(overId);
  if (from < 0 || to < 0) return order;
  const [moved] = next.splice(from, 1);
  if (!moved) return order;
  next.splice(to, 0, moved);
  return next;
}

export function useTablePrefs(tableId: string, columns: TableToolbarColumn[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qKey = `${tableId}.q`;
  const gKey = `${tableId}.group`;
  const vKey = `${tableId}.view`;
  const knownIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const system = useMemo(() => systemPreference(columns), [columns]);
  const locked = useMemo(
    () => new Set(columns.filter((column) => column.locked).map((column) => column.id)),
    [columns],
  );

  const urlQuery = searchParams.get(qKey) ?? "";
  const [draftQuery, setDraftQuery] = useState(urlQuery);
  const [appliedQuery, setAppliedQuery] = useState(urlQuery);
  const [preference, setPreference] = useState<ListColumnPreference>(system);

  useEffect(() => {
    setDraftQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    let cancelled = false;
    void getEffectiveUiPreference(`table.${tableId}`, knownIds, system).then((result) => {
      if (cancelled) return;
      setPreference(result.effective);
    });
    return () => {
      cancelled = true;
    };
  }, [tableId, knownIds, system]);

  const writeUrl = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(draftQuery), 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    if (appliedQuery === urlQuery) return;
    writeUrl((params) => {
      if (appliedQuery) params.set(qKey, appliedQuery);
      else params.delete(qKey);
    });
  }, [appliedQuery, qKey, urlQuery, writeUrl]);

  const persist = useCallback(
    (next: ListColumnPreference) => {
      setPreference(next);
      void saveUserUiPreference(`table.${tableId}`, next);
    },
    [tableId],
  );

  const urlGroup = searchParams.get(gKey);
  const urlView = searchParams.get(vKey);
  const groupBy = urlGroup ?? preference.groupBy ?? NONE;
  const view: TableViewMode = urlView === "grid" || (!urlView && preference.viewMode === "grid") ? "grid" : "list";

  const setGroupBy = useCallback(
    (value: string) => {
      writeUrl((params) => {
        if (!value || value === NONE) params.delete(gKey);
        else params.set(gKey, value);
      });
      persist({ ...preference, groupBy: value || NONE });
    },
    [gKey, persist, preference, writeUrl],
  );

  const setView = useCallback(
    (value: TableViewMode) => {
      writeUrl((params) => {
        if (value === "list") params.delete(vKey);
        else params.set(vKey, value);
      });
      persist({ ...preference, viewMode: value });
    },
    [persist, preference, vKey, writeUrl],
  );

  const visibleSet = useMemo(() => {
    const visible = new Set(preference.visible);
    for (const id of locked) visible.add(id);
    return visible;
  }, [locked, preference.visible]);

  const orderedColumns = useMemo(() => {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const ordered = preference.order
      .map((id) => byId.get(id))
      .filter((column): column is TableToolbarColumn => column != null);
    for (const column of columns) {
      if (!ordered.some((item) => item.id === column.id)) ordered.push(column);
    }
    return ordered;
  }, [columns, preference.order]);

  const toggleColumn = useCallback(
    (id: string) => {
      if (locked.has(id)) return;
      const visible = new Set(preference.visible);
      if (visible.has(id)) visible.delete(id);
      else visible.add(id);
      for (const lockedId of locked) visible.add(lockedId);
      persist({ ...preference, visible: [...visible] });
    },
    [locked, persist, preference],
  );

  const reorderColumn = useCallback(
    (activeId: string, overId: string) => {
      if (locked.has(activeId) || locked.has(overId)) return;
      persist({ ...preference, order: reorderIds(preference.order, activeId, overId) });
    },
    [locked, persist, preference],
  );

  const resetColumns = useCallback(() => {
    persist(system);
  }, [persist, system]);

  return {
    query: draftQuery,
    appliedQuery,
    setQuery: setDraftQuery,
    groupBy,
    setGroupBy,
    view,
    setView,
    orderedColumns,
    isVisible: (id: string) => visibleSet.has(id),
    toggleColumn,
    reorderColumn,
    resetColumns,
    visibleCount: orderedColumns.filter((column) => visibleSet.has(column.id)).length,
  };
}
