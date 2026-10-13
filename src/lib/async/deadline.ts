/**
 * Deadline helpers with no backend affinity — they bound a promise, not a
 * client. Kept separate from the Supabase module so the Firebase layer does not
 * have to import a Supabase-named path to get them.
 */

/** Covers the auth probe including its retry. */
export const MIDDLEWARE_AUTH_BUDGET_MS = 3_000;

/** Covers the app_settings + profiles reads, which run in parallel. */
export const MIDDLEWARE_QUERY_BUDGET_MS = 2_500;

/**
 * Resolves to `onTimeout()` if `op` has not settled within `ms`.
 *
 * A backstop for a network timeout: it also bounds work that never reached the
 * network, such as a client stuck resolving cookies.
 */
export async function withDeadline<T>(
  op: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      op,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
