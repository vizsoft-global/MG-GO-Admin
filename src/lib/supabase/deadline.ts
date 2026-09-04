/**
 * Timeouts for Supabase I/O on the request path.
 *
 * Vercel terminates Routing Middleware at 25s with MIDDLEWARE_INVOCATION_TIMEOUT,
 * and that budget covers every call the proxy makes. Supabase failures are slow
 * rather than fast — a Cloudflare 522 in front of GoTrue surfaces after ~15s — so
 * an uncapped call spends the whole budget on one request and 504s the route.
 */

/** Covers the auth probe including its retry. */
export const MIDDLEWARE_AUTH_BUDGET_MS = 3_000;

/** Covers the app_settings + profiles reads, which run in parallel. */
export const MIDDLEWARE_QUERY_BUDGET_MS = 2_500;

function combineSignals(
  a: AbortSignal | null | undefined,
  b: AbortSignal,
): AbortSignal {
  if (!a) return b;
  // Node 20.3+. Falling back to the timeout alone still bounds the call.
  return typeof AbortSignal.any === "function" ? AbortSignal.any([a, b]) : b;
}

/**
 * A `fetch` that aborts after `timeoutMs`, for `createServerClient`'s `global`.
 *
 * Aborting rather than racing releases the socket, and it is what reaches
 * auth-js and PostgREST as a failure they already classify as retryable.
 */
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      signal: combineSignals(init?.signal, AbortSignal.timeout(timeoutMs)),
    });
}

/**
 * Resolves to `onTimeout()` if `op` has not settled within `ms`.
 *
 * A backstop for the fetch timeout above: it also bounds work that never
 * reached the network, such as a client stuck resolving cookies.
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

/**
 * A read that distinguishes "no row" from "could not read".
 *
 * `maybeSingle()` reports both as `data: null`, which is what let a transient
 * failure be read as a missing profile — and a missing profile is grounds for
 * signing the admin out.
 */
export type GuardedRead<T> =
  | { data: T | null; failed: false }
  | { data: null; failed: true };

/** Runs a Supabase read so neither a rejection nor a timeout can throw. */
export async function guardedRead<T>(
  op: PromiseLike<{ data: T | null; error: unknown }>,
  ms: number,
): Promise<GuardedRead<T>> {
  const failed: GuardedRead<T> = { data: null, failed: true };

  return withDeadline(
    Promise.resolve(op).then(
      ({ data, error }): GuardedRead<T> =>
        error ? failed : { data: data ?? null, failed: false },
      () => failed,
    ),
    ms,
    () => failed,
  );
}
