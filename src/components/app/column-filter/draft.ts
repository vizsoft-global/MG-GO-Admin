import type { ColumnFilterDraft, ColumnFilterOption } from "./types";

/**
 * The checklist, narrowed by what is typed in the popover's search box.
 *
 * Case-insensitive partial match against the printed label *and* the stored
 * value, so "sal" finds `Americana - Salmiya` and `CLI-270` is reachable from
 * `270`. This runs on every keystroke — there is no minimum length.
 */
export function filterColumnOptions(
  options: readonly ColumnFilterOption[],
  query: string,
): ColumnFilterOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      option.value.toLowerCase().includes(needle),
  );
}

/** Options whose label or stored value contains the query, case-insensitively. */
export function matchingValues(
  values: readonly string[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...values];
  return values.filter((value) => value.toLowerCase().includes(needle));
}

/** Rows behind every option still visible in the checklist. */
export function visibleOptionCount(options: readonly ColumnFilterOption[]): number {
  return options.reduce((total, option) => total + (option.count ?? 0), 0);
}

/** True when a checklist option is already ticked. */
export function isPicked(draft: ColumnFilterDraft, value: string): boolean {
  return draft.picked.includes(value);
}

/** Every visible option is ticked, and there is something to tick. */
export function allVisiblePicked(
  draft: ColumnFilterDraft,
  visible: readonly ColumnFilterOption[],
): boolean {
  return visible.length > 0 && visible.every((option) => draft.picked.includes(option.value));
}

/** Tick the whole visible set, or clear it when it is already fully ticked. */
export function toggleVisible(
  draft: ColumnFilterDraft,
  visible: readonly ColumnFilterOption[],
): string[] {
  if (allVisiblePicked(draft, visible)) return [];
  return visible.map((option) => option.value);
}

/**
 * True when the draft would narrow the table.
 *
 * An empty draft answers `false`, which is what lets the live channel restore
 * the full table on the same tick as the clear rather than after a debounce.
 */
export function draftNarrows(draft: ColumnFilterDraft): boolean {
  switch (draft.mode) {
    case "text":
      return draft.text.trim() !== "";
    case "range":
      return draft.min.trim() !== "" || draft.max.trim() !== "";
    case "list":
      return draft.query.trim() !== "" || draft.picked.length > 0;
    default: {
      const exhaustive: never = draft.mode;
      return exhaustive;
    }
  }
}
