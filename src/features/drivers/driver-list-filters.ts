/**
 * Whether the Employees table is narrowed by anything at all.
 *
 * The funnel count alone is not enough: the tab, the level chip, the search box
 * and a `?project=` deep-link all narrow the list, and a Clear filters button
 * that ignores them leaves the operator staring at a filtered table they cannot
 * reset. One expression, exported, so the button's enabled state and its badge
 * cannot drift from what the list is actually doing.
 */
export function hasAnyDriverListFilter(input: {
  columnFilterCount: number;
  search: string;
  levelFilter: string;
  tabFilter: string;
  projectParam?: string | null;
}): boolean {
  return (
    input.columnFilterCount > 0 ||
    input.search.trim() !== "" ||
    input.levelFilter !== "all" ||
    input.tabFilter !== "all" ||
    Boolean(input.projectParam?.trim())
  );
}

/** The badge on Clear filters: one per active control, funnels counted individually. */
export function driverListFilterCount(input: {
  columnFilterCount: number;
  search: string;
  levelFilter: string;
  tabFilter: string;
  projectParam?: string | null;
}): number {
  return (
    input.columnFilterCount +
    (input.search.trim() ? 1 : 0) +
    (input.levelFilter !== "all" ? 1 : 0) +
    (input.tabFilter !== "all" ? 1 : 0) +
    (input.projectParam?.trim() ? 1 : 0)
  );
}
