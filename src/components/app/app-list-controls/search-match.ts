export type SearchFieldAccessor<T> = (row: T) => string | number | null | undefined;

/** Lowercased words of one value, so "Al Hamra" answers "ham" and "al h". */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * One search box over every field. A query is split into tokens and every token
 * must match somewhere, which is what makes "jenson hawally" find the rider
 * instead of nothing: the Employees list has searched this way since the roster
 * toolbar pass, and the other lists have to agree with it.
 *
 * A token matches when a field's whole value contains it (so an order id is
 * searchable from its middle) or when any word of a field starts with it (so a
 * surname is a prefix). There is no minimum length: a single digit is a real
 * query.
 */
export function fieldSearchMatch<T>(
  row: T,
  query: string,
  accessors: Record<string, SearchFieldAccessor<T>>,
): boolean {
  const tokens = words(query);
  if (tokens.length === 0) return true;
  const haystack = Object.values(accessors)
    .map((read) => read(row))
    .filter((value): value is string | number => value != null && value !== "")
    .map((value) => {
      const text = String(value).toLowerCase();
      return { text, words: words(text) };
    });
  return tokens.every((token) =>
    haystack.some(
      (value) =>
        value.text.includes(token) ||
        value.words.some((word) => word.startsWith(token)),
    ),
  );
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
