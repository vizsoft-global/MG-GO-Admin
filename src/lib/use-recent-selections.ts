"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "dpd-recent-select:";

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function useRecentSelections(key: string, max = 10) {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const [ready, setReady] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        setRecents(normalizeIds(JSON.parse(raw)).slice(0, max));
      }
    } catch {
      setRecents([]);
    } finally {
      setReady(true);
    }
  }, [storageKey, max]);

  const persist = useMemo(
    () => (next: string[]) => {
      setRecents(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage write failures.
      }
    },
    [storageKey],
  );

  const push = (id: string) => {
    if (!ready || !id) return;
    persist([id, ...recents.filter((item) => item !== id)].slice(0, max));
  };

  const remove = (id: string) => {
    if (!ready || !id) return;
    persist(recents.filter((item) => item !== id));
  };

  return { recents, push, remove, ready };
}

