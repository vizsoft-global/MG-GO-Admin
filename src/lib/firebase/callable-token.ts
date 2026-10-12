/** Firebase ID tokens live for an hour; refresh a little before that. */
export const TOKEN_TTL_MS = 45 * 60 * 1000;

export type IdTokenKind = "session" | "cron";

/**
 * Session tokens are keyed by uid. Cron tokens are keyed by the same
 * super-admin uid with a `cron:` prefix so a panel session token, which does
 * not carry `superAdmin`, cannot be reused for a cron call.
 */
export function idTokenCacheKey(uid: string, kind: IdTokenKind): string {
  return kind === "cron" ? `cron:${uid}` : uid;
}

type Entry = { token: string; expiresAt: number };

const cache = new Map<string, Entry>();

export function clearIdTokenCache(): void {
  cache.clear();
}

export function forgetIdToken(uid: string, kind: IdTokenKind): void {
  cache.delete(idTokenCacheKey(uid, kind));
}

export async function loadCachedIdToken(input: {
  uid: string;
  kind: IdTokenKind;
  apiKey: string;
  createCustomToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<string | null> {
  const now = input.now ?? Date.now;
  const key = idTokenCacheKey(input.uid, input.kind);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.token;

  const fetchImpl = input.fetchImpl ?? fetch;
  const customToken = await input.createCustomToken();
  const response = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${input.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { idToken?: string } | null;
  if (!body?.idToken) return null;
  cache.set(key, { token: body.idToken, expiresAt: now() + TOKEN_TTL_MS });
  return body.idToken;
}
