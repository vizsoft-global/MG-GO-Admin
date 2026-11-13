/**
 * The one rule the HR sheet's toolbar filters need.
 *
 * The cells that consumed a catalog picker are read-only now — the client's 3.1
 * and 3.2 make every "From employees" and Configuration column reflect the
 * Employee profile rather than accept an edit here — so the picker tables that
 * used to live in this module are gone. What survives is the filter list, which
 * still has to offer the master's values as well as the sheet's.
 */

/**
 * One filter list: the values the sheet already prints, then the rest of the
 * master behind them.
 *
 * The toolbar filter matches the printed cell, so its options are labels. What
 * the sheet holds comes first because that is what an operator narrows by; the
 * remainder of the catalog follows, so a restaurant or nationality added in
 * Employee Settings is pickable before any rider carries it.
 */
export function masterFilterValues(
  present: readonly string[],
  master: readonly string[],
  skip: ReadonlySet<string> = new Set(["", "—", "–", "-"]),
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...present, ...master]) {
    const trimmed = value.trim();
    if (!trimmed || skip.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
