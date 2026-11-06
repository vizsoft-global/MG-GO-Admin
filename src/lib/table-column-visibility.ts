export type TableColumnState = {
  visible: string[];
  order: string[];
};

function stringsOnly(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

export function loadTableColumnState(storageKey: string): TableColumnState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Legacy shape: a bare array of visible ids.
    if (Array.isArray(parsed)) {
      return { visible: stringsOnly(parsed), order: [] };
    }
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { visible?: unknown; order?: unknown };
    if (!Array.isArray(record.visible)) return null;
    return { visible: stringsOnly(record.visible), order: stringsOnly(record.order) };
  } catch {
    return null;
  }
}

export function saveTableColumnState(storageKey: string, state: TableColumnState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ visible: state.visible, order: state.order }),
    );
  } catch {
    /* ignore */
  }
}

/** @deprecated use loadTableColumnState */
export function loadTableColumnVisibility(storageKey: string): string[] | null {
  return loadTableColumnState(storageKey)?.visible ?? null;
}

/** @deprecated use saveTableColumnState */
export function saveTableColumnVisibility(storageKey: string, visibleIds: string[]) {
  const order = loadTableColumnState(storageKey)?.order ?? [];
  saveTableColumnState(storageKey, { visible: visibleIds, order });
}

/** Moves `id` one slot in the given direction. Out-of-range moves are no-ops. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return ids;
  const target = index + dir;
  if (target < 0 || target >= ids.length) return ids;
  const next = ids.slice();
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}

/** Drag-and-drop reorder: drops `activeId` at `overId`'s slot, preserving the rest. */
export function reorderIds(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/**
 * Keeps the saved order but drops unknown ids and re-appends any known id the
 * saved order never mentioned (new columns land in their declared position).
 */
export function reconcileOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of saved) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  for (const id of defaults) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
