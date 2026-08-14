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

/** Resolves a driver's persisted duty JWT to a user id. */
export async function resolveUserFromToken(
  config: SupabaseConfig,
  token: string,
): Promise<AuthUser | null> {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as AuthUser;
  return user?.id ? user : null;
}
