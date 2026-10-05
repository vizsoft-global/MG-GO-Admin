/** Cron bearer check — extracted so the drain route can be tested without Next. */
export function authorizeEsignBatchDrain(
  authorization: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  const expected = secret?.trim() ?? "";
  if (!expected) return false;
  const header = authorization?.trim() ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  return bearer.length > 0 && bearer === expected;
}
