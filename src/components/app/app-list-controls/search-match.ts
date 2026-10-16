export type SearchFieldAccessor<T> = (row: T) => string | number | null | undefined;

export function fieldSearchMatch<T>(
  row: T,
  query: string,
  field: string,
  accessors: Record<string, SearchFieldAccessor<T>>,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (field === "all" || field === "") {
    return Object.values(accessors).some((read) => contains(read(row), needle));
  }
  const read = accessors[field];
  if (!read) return true;
  return contains(read(row), needle);
}

function contains(value: string | number | null | undefined, needle: string): boolean {
  if (value == null) return false;
  return String(value).toLowerCase().includes(needle);
}

/**
 * The clear button belongs to the control, not to each page: it is rendered
 * exactly when the box holds something to clear. Attendance reported a missing
 * "x" because the rule lived in the page's copy of the markup, so this one
 * predicate is what every list reads.
 */
export function searchClearVisible(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}
