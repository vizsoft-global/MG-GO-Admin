/** Unassigned matches a blank project or the literal. Keeta does not match a blank project. */
export function projectKeyMatches(stored: unknown, locked: string): boolean {
  const raw = typeof stored === "string" ? stored.trim().toLowerCase() : "";
  if (locked === "unassigned") return raw === "" || raw === "unassigned";
  return raw === locked;
}
