import {
  dropColumnInOrder,
  mergeColumnOrder,
  moveColumnInOrder,
} from "@/lib/table-column-order";

/**
 * Column order and visibility kept in `localStorage`, one key per table.
 *
 * The payroll sheets store the same two facts on the server, because they are
 * arranged by someone who is paid to arrange them and the choice should follow
 * them between machines. Every other table in the panel is a convenience, so its
 * layout lives in the browser: no round trip, no preference row, and a table
 * that has never been arranged renders its catalogue order.
 *
 * The stored shape is deliberately the *saved* half only — the catalogue is read
 * at render time. A column added later therefore appears in its declared place
 * instead of being invisible because an older layout never knew about it.
 */
export type ColumnLayout = {
  order: readonly string[];
  visible: readonly string[];
};

/** `dpdadmin.columnLayout.<tableId>` — one key per table, so nothing collides. */
export const COLUMN_LAYOUT_PREFIX = "dpdadmin.columnLayout.v1";

export function columnLayoutKey(tableId: string): string {
  return `${COLUMN_LAYOUT_PREFIX}:${tableId}`;
}

/** A fresh layout: catalogue order, every column shown. */
export function defaultColumnLayout(columnIds: readonly string[]): ColumnLayout {
  return { order: [...columnIds], visible: [...columnIds] };
}

/**
 * Reconciles a stored layout against the catalogue.
 *
 * Saved ids keep their saved order; ids the catalogue no longer has are dropped;
 * columns the catalogue gained join at the end in declared order. Visible ids are
 * filtered to what exists, and an empty or unreadable visible list means "all",
 * never "none" — a table that hides every column has no way back.
 */
export function resolveColumnLayout(
  columnIds: readonly string[],
  saved: Partial<ColumnLayout> | null | undefined,
): ColumnLayout {
  const order = mergeColumnOrder(columnIds, saved?.order ?? null);
  const known = new Set(order);
  const visible = (saved?.visible ?? []).filter((id) => known.has(id));
  return { order, visible: visible.length > 0 ? visible : [...order] };
}

export function isColumnVisible(layout: ColumnLayout, id: string): boolean {
  return layout.visible.includes(id);
}

/**
 * Ticks or unticks one column. The last visible column cannot be hidden: an
 * empty table cannot be repaired from inside its own popover.
 */
export function toggleColumnVisibility(layout: ColumnLayout, id: string): ColumnLayout {
  if (!layout.order.includes(id)) return layout;
  if (layout.visible.includes(id)) {
    if (layout.visible.length <= 1) return layout;
    return { order: layout.order, visible: layout.visible.filter((item) => item !== id) };
  }
  const shown = new Set(layout.visible);
  shown.add(id);
  return { order: layout.order, visible: layout.order.filter((item) => shown.has(item)) };
}

/**
 * Moves one column one slot up (-1) or down (1).
 *
 * A pinned column does not move, and a column may not be swapped *into* a pinned
 * column's slot either — otherwise pressing ↑ on the first movable column would
 * push the pinned identity columns down the table.
 */
export function moveColumn(
  layout: ColumnLayout,
  id: string,
  dir: -1 | 1,
  lockedIds: readonly string[] = [],
): ColumnLayout {
  const locked = new Set(lockedIds);
  if (locked.has(id)) return layout;
  const from = layout.order.indexOf(id);
  if (from < 0) return layout;
  const target = layout.order[from + dir];
  if (target == null || locked.has(target)) return layout;
  const order = moveColumnInOrder(layout.order, id, dir);
  if (order.join("|") === layout.order.join("|")) return layout;
  return { order, visible: layout.visible };
}

/** Drag-and-drop: the dragged column takes the dropped column's slot. */
export function reorderColumn(
  layout: ColumnLayout,
  activeId: string,
  overId: string,
  lockedIds: readonly string[] = [],
): ColumnLayout {
  const locked = new Set(lockedIds);
  if (locked.has(activeId) || locked.has(overId)) return layout;
  const order = dropColumnInOrder(layout.order, activeId, overId);
  if (order.join("|") === layout.order.join("|")) return layout;
  return { order, visible: layout.visible };
}

/** True when a column's arrow would move it: not locked, and not at that end. */
export function canMoveColumn(
  layout: ColumnLayout,
  id: string,
  dir: -1 | 1,
  lockedIds: readonly string[] = [],
): boolean {
  if (lockedIds.includes(id)) return false;
  const from = layout.order.indexOf(id);
  if (from < 0) return false;
  const target = layout.order[from + dir];
  return target != null && !lockedIds.includes(target);
}

/** Parses a stored string. Anything unreadable is "never arranged". */
export function parseColumnLayout(raw: string | null): ColumnLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const order = (parsed as { order?: unknown }).order;
    const visible = (parsed as { visible?: unknown }).visible;
    if (!Array.isArray(order)) return null;
    return {
      order: order.filter((id): id is string => typeof id === "string"),
      visible: Array.isArray(visible)
        ? visible.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function serializeColumnLayout(layout: ColumnLayout): string {
  return JSON.stringify({ order: [...layout.order], visible: [...layout.visible] });
}
