"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getEffectiveUiPreference,
  saveUserUiPreference,
} from "@/features/settings/ui-preferences-actions";
import type { ListColumnPreference } from "@/lib/ui-preferences/types";
import { listSearchDelayMs } from "@/lib/search/list-search";
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

  /**
   * The read below is a server action, and a server action is addressed to the
   * route that is mounted when it is sent. Depending on object identity
   * (`knownIds` / `system`) made the effect fire on every render, so a render
   * that landed after a `router.push()` posted the action to the *new* route —
   * where it is not registered, so the server answered `application/json` `{}`
   * and the router threw "An unexpected response was received from the
   * server." A signature string only changes when the table itself changes.
   */
  const preferenceSignature = `${knownIds.join("|")}::${system.visible.join("|")}`;

  const urlQuery = searchParams.get(qKey) ?? "";
  const [draftQuery, setDraftQuery] = useState(urlQuery);
  const [appliedQuery, setAppliedQuery] = useState(urlQuery);
  const [preference, setPreference] = useState<ListColumnPreference>(system);

  // Keep the search box in step with the URL (back/forward, or another page
  // writing the same key) during render rather than in an effect — a
  // synchronous `setState` inside an effect cascades an extra render.
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);
    setDraftQuery(urlQuery);
  }

  useEffect(() => {
    let cancelled = false;
    void getEffectiveUiPreference(`table.${tableId}`, knownIds, system)
      .then((result) => {
        if (!cancelled) setPreference(result.effective);
      })
      // The stored preference is a convenience; the system defaults render
      // either way, so a failed read must not raise a page error.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `preferenceSignature` stands in for `knownIds` / `system` so re-creating
    // those arrays cannot re-send the action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, preferenceSignature]);

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
    // Clearing is an undo, not a query: `setQuery` below applies it on the
    // click, so this timer is the typing path only. A whitespace-only box still
    // answers 0 here, which keeps the two paths in step.
    const delay = listSearchDelayMs(draftQuery);
    const timer = window.setTimeout(() => setAppliedQuery(draftQuery), delay);
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

  /**
   * One-step nudge for the arrow buttons. Refuses at either end of the list and
   * never swaps past a locked column, so a pinned first column cannot be moved.
   */
  const moveColumn = useCallback(
    (id: string, dir: -1 | 1) => {
      if (locked.has(id)) return;
      const index = preference.order.indexOf(id);
      if (index < 0) return;
      const targetId = preference.order[index + dir];
      if (targetId == null || locked.has(targetId)) return;
      persist({ ...preference, order: reorderIds(preference.order, id, targetId) });
    },
    [locked, persist, preference],
  );

  const resetColumns = useCallback(() => {
    persist(system);
  }, [persist, system]);

  const setQuery = useCallback((value: string) => {
    setDraftQuery(value);
    // An empty box applies on the click: the × and "Clear all" restore the full
    // table without waiting out the debounce. Typed text still waits for it.
    if (listSearchDelayMs(value) === 0) setAppliedQuery(value);
  }, []);

  return {
    query: draftQuery,
    appliedQuery,
    setQuery,
    groupBy,
    setGroupBy,
    view,
    setView,
    orderedColumns,
    isVisible: (id: string) => visibleSet.has(id),
    toggleColumn,
    reorderColumn,
    moveColumn,
    resetColumns,
    visibleCount: orderedColumns.filter((column) => visibleSet.has(column.id)).length,
  };
}
