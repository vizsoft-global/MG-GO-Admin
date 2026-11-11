import type { ListColumnPreference } from "@/lib/ui-preferences/types";

/**
 * Column order for a table's column picker: the up/down arrows and drag-and-drop
 * math, shared by every table that lets an operator arrange its columns.
 *
 * The order is a plain list of ids, so a saved preference survives a column being
 * renamed or removed: ids that no longer exist are dropped, new columns join in
 * the canonical order they were declared, and nothing throws.
 */

/** A fresh order: every column shown, in catalogue order. */
export function systemColumnPreference(columnIds: readonly string[]): ListColumnPreference {
  return { order: [...columnIds], visible: [...columnIds], sort: null };
}

/** Saved ids first, in their saved order, then every id the catalogue has gained. */
export function mergeColumnOrder(
  allIds: readonly string[],
  saved: readonly string[] | null | undefined,
): string[] {
  if (!saved || saved.length === 0) return [...allIds];
  const known = new Set(allIds);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of saved) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of allIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

/** Moves one column one slot up (-1) or down (1); a move off either end is a no-op. */
export function moveColumnInOrder(
  order: readonly string[],
  id: string,
  dir: -1 | 1,
): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const to = from + dir;
  if (to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next[from] = order[to]!;
  next[to] = order[from]!;
  return next;
}

/** Drag-and-drop: the dragged column takes the slot of the column it was dropped on. */
export function dropColumnInOrder(
  order: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  if (activeId === overId) return [...order];
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from < 0 || to < 0) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** Resolves ids to their catalogue entries, dropping anything that no longer exists. */
export function orderByIds<T extends { id: string }>(
  order: readonly string[],
  byId: ReadonlyMap<string, T>,
): T[] {
  const out: T[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) out.push(entry);
  }
  return out;
}
