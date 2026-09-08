export type LocalJwtSession = {
  user: { id: string } | null;
  expires_at?: number | null;
};

/**
 * `getUser()` is a network round trip. A compile stall or a hung GoTrue
 * call can make the wall-clock probe report `unavailable` even when the
 * browser still holds an unexpired access token. `getSession()` reads that
 * JWT locally — use it only as a fallback, never as the first check.
 */
export function userFromLocalJwt(
  session: LocalJwtSession | null | undefined,
  nowMs = Date.now(),
): { id: string } | null {
  if (!session?.user?.id) return null;
  if (
    typeof session.expires_at === "number" &&
    session.expires_at * 1000 <= nowMs
  ) {
    return null;
  }
  return session.user;
}
