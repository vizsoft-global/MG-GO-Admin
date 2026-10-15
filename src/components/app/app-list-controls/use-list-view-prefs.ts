"use client";

import { useCallback, useEffect, useState } from "react";
import type { ListViewMode } from "./types";

export type ListViewPrefs = {
  viewMode: ListViewMode;
  groupBy: string;
  searchField: string;
};

const DEFAULT_PREFS: ListViewPrefs = {
  viewMode: "table",
  groupBy: "none",
  searchField: "all",
};

function storageKey(prefKey: string): string {
  return `list-view:${prefKey}`;
}

function readPrefs(prefKey: string): ListViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(storageKey(prefKey));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ListViewPrefs>;
    return {
      viewMode: parsed.viewMode === "cards" ? "cards" : "table",
      groupBy: typeof parsed.groupBy === "string" && parsed.groupBy ? parsed.groupBy : "none",
      searchField:
        typeof parsed.searchField === "string" && parsed.searchField ? parsed.searchField : "all",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useListViewPrefs(prefKey: string) {
  const [prefs, setPrefs] = useState<ListViewPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(readPrefs(prefKey));
  }, [prefKey]);

  const update = useCallback(
    (patch: Partial<ListViewPrefs>) => {
      setPrefs((current) => {
        const next = { ...current, ...patch };
        try {
          window.localStorage.setItem(storageKey(prefKey), JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
        return next;
      });
    },
    [prefKey],
  );

  return { prefs, update };
}
