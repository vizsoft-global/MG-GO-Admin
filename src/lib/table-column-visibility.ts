export function loadTableColumnVisibility(storageKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

export function saveTableColumnVisibility(storageKey: string, visibleIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(visibleIds));
  } catch {
    /* ignore */
  }
}
