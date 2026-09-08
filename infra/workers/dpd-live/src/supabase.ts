/**
 * Minimal Supabase REST/Realtime client.
 *
 * `supabase-js` runs in Workers, but everything this hub needs is four HTTP calls,
 * and the parts of the library it would drag in (auth storage, realtime client,
 * postgrest builder) are either unusable in a hibernating Durable Object or cost
 * bundle size for nothing.
 */

export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
};

function serviceHeaders(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    "User-Agent": "dpd-live/fleet-room",
  };
}

export async function callRpc<T>(
  config: SupabaseConfig,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(config),
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`rpc_${fn}_failed_${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function selectRows<T>(
  config: SupabaseConfig,
  path: string,
): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: serviceHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`select_failed_${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T[];
}

/**
 * Second rail. Sent over REST rather than a Realtime WebSocket on purpose: a
 * hibernating Durable Object cannot hold an outbound socket open, so a WS mirror
 * would silently stop working the moment the room went quiet.
 */
export async function broadcast(
  config: SupabaseConfig,
  topic: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const response = await fetch(`${config.url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: serviceHeaders(config),
    body: JSON.stringify({ messages: [{ topic, event, payload }] }),
  });
  if (!response.ok) {
    throw new Error(`broadcast_failed_${response.status}`);
  }
}

export type AuthUser = { id: string; role?: string };

/**
 * Identifies this hub to GoTrue. Workers' `fetch` sends no User-Agent at all, which
 * is how ~1.25M `/auth/v1/user` rows on 3 Sep had an empty UA and could not be told
 * apart from a scraper in the Supabase logs.
 */
export const WORKER_USER_AGENT = "dpd-live/fleet-room";

/**
 * Reads `exp` and `sub` out of a JWT without verifying it. Used only as a pre-filter:
 * a token whose own payload says it has expired cannot possibly be accepted by
 * GoTrue, so asking is a wasted round trip. Anything that does not parse is passed
 * through to GoTrue, which remains the authority.
 */
export function decodeJwtClaims(token: string): { sub?: string; exp?: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const payload = JSON.parse(binary) as { sub?: unknown; exp?: unknown };
    return {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

/** A token whose payload `exp` is already in the past. */
export function isJwtExpired(token: string, nowMs = Date.now()): boolean {
  const claims = decodeJwtClaims(token);
  return claims?.exp != null && claims.exp * 1000 <= nowMs;
}

/**
 * `rejected` is GoTrue's own verdict (401/403, or a payload that already expired) and
 * safe to remember; `unavailable` is a 5xx / network failure and must not be, or a
 * ten-second GoTrue blip would silence a live rider for the negative TTL.
 */
export type TokenResolution =
  | { kind: "ok"; user: AuthUser }
  | { kind: "rejected" }
  | { kind: "unavailable" };

/** Resolves a driver's persisted duty JWT to a user id. */
export async function resolveUserFromToken(
  config: SupabaseConfig,
  token: string,
): Promise<TokenResolution> {
  if (isJwtExpired(token)) return { kind: "rejected" };
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "User-Agent": WORKER_USER_AGENT,
      },
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { kind: "rejected" };
  if (!response.ok) return { kind: "unavailable" };
  const user = (await response.json().catch(() => null)) as AuthUser | null;
  return user?.id ? { kind: "ok", user } : { kind: "rejected" };
}
