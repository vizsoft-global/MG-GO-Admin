/**
 * How long a list search box waits before it narrows its table.
 *
 * Short enough that a keystroke feels like it filtered the table it was typed
 * into, long enough that a fast typist does not fire one request per letter.
 * Every list in the panel reads this one number so a search box cannot be
 * faster on one page than another.
 */
export const LIST_SEARCH_DEBOUNCE_MS = 150;

/**
 * Delay before a draft query becomes the applied query.
 *
 * An empty box answers 0. Clearing a search is an undo, not a query, and an
 * undo that lands 150ms after the click reads as lag — so both the `×` inside
 * the box and "Clear all" restore the full dataset on the same tick.
 */
export function listSearchDelayMs(value: string): number {
  return value.trim() === "" ? 0 : LIST_SEARCH_DEBOUNCE_MS;
}
