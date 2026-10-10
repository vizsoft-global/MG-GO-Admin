/**
 * Firebase helpers for the fleet room.
 *
 * Ingest tokens are verified here. Snapshot, durable flush, fleet events and the
 * ops relay go to Cloud Functions over HTTPS with `X-Worker-Secret`. The filename
 * stays so existing imports of the token verifier do not move.
 */

export type WorkerCallerEnv = {
  FIREBASE_FUNCTIONS_BASE_URL: string;
  WORKER_SHARED_SECRET: string;
};

/** Identifies this hub on outbound fetches. Workers' `fetch` sends no User-Agent at all. */
export const WORKER_USER_AGENT = "dpd-live/fleet-room";

export async function callWorkerFunction<T>(
  env: WorkerCallerEnv,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const base = env.FIREBASE_FUNCTIONS_BASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("firebase_functions_base_missing");
  const response = await fetch(`${base}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Secret": env.WORKER_SHARED_SECRET ?? "",
      "User-Agent": WORKER_USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`worker_${name}_failed_${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export type AuthUser = { id: string; role?: string };

export type FirebaseAuthConfig = { projectId: string };

export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const JWKS_FALLBACK_TTL_MS = 60 * 60_000;

type FirebaseJwk = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
};

type JwksCache = { keys: FirebaseJwk[]; expiresAt: number };

let jwksCache: JwksCache | null = null;
let jwksInFlight: Promise<JwksFetchResult> | null = null;

type JwksFetchResult = { kind: "ok"; keys: FirebaseJwk[] } | { kind: "unavailable" };

type TokenResolver = (
  config: FirebaseAuthConfig,
  token: string,
) => Promise<TokenResolution>;

let tokenResolverOverride: TokenResolver | null = null;

/** Test-only seam so FleetRoom ingest tests do not depend on a live JWKS. */
export function setResolveUserFromTokenForTests(fn: TokenResolver | null): void {
  tokenResolverOverride = fn;
}

export function resetFirebaseJwksCacheForTests(): void {
  jwksCache = null;
  jwksInFlight = null;
}

/**
 * Reads `exp` and `sub` out of a JWT without verifying it. Used only as a pre-filter:
 * a token whose own payload says it has expired cannot possibly be accepted, so the
 * JWKS fetch is skipped. Anything that does not parse is rejected by verify, not here.
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
 * `rejected` is a cryptographic or claim verdict (expired, bad sig, wrong iss/aud)
 * and safe to remember; `unavailable` is a JWKS 5xx / network failure and must not
 * be, or a ten-second Google blip would silence a live rider for the negative TTL.
 */
export type TokenResolution =
  | { kind: "ok"; user: AuthUser }
  | { kind: "rejected" }
  | { kind: "unavailable" };

function decodeJwtJson<T>(part: string): T | null {
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseCacheControlMs(header: string | null): number {
  if (!header) return JWKS_FALLBACK_TTL_MS;
  const match = /max-age=(\d+)/i.exec(header);
  if (!match) return JWKS_FALLBACK_TTL_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return JWKS_FALLBACK_TTL_MS;
  return seconds * 1000;
}

async function fetchFirebaseJwks(): Promise<JwksFetchResult> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return { kind: "ok", keys: jwksCache.keys };
  }
  if (jwksInFlight) return jwksInFlight;

  jwksInFlight = (async () => {
    let response: Response;
    try {
      response = await fetch(FIREBASE_JWKS_URL, {
        headers: { "User-Agent": WORKER_USER_AGENT },
      });
    } catch {
      return { kind: "unavailable" as const };
    }
    if (response.status >= 500 || !response.ok) return { kind: "unavailable" as const };
    const body = (await response.json().catch(() => null)) as { keys?: unknown } | null;
    const keys = Array.isArray(body?.keys) ? (body.keys as FirebaseJwk[]) : null;
    if (!keys) return { kind: "unavailable" as const };
    jwksCache = {
      keys,
      expiresAt: Date.now() + parseCacheControlMs(response.headers.get("cache-control")),
    };
    return { kind: "ok" as const, keys };
  })();

  try {
    return await jwksInFlight;
  } finally {
    jwksInFlight = null;
  }
}

async function verifyRs256(token: string, jwk: FirebaseJwk): Promise<boolean> {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return false;
  const parts = token.split(".");
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  } catch {
    return false;
  }
}

/** Resolves a Firebase ID token to the Auth uid (`drivers.id`). */
export async function resolveUserFromToken(
  config: FirebaseAuthConfig,
  token: string,
): Promise<TokenResolution> {
  if (tokenResolverOverride) return tokenResolverOverride(config, token);
  if (isJwtExpired(token)) return { kind: "rejected" };

  const parts = token.split(".");
  if (parts.length !== 3) return { kind: "rejected" };

  const header = decodeJwtJson<{ alg?: unknown; kid?: unknown }>(parts[0]);
  const payload = decodeJwtJson<{
    iss?: unknown;
    aud?: unknown;
    sub?: unknown;
    exp?: unknown;
  }>(parts[1]);
  if (!header || !payload) return { kind: "rejected" };
  if (header.alg !== "RS256") return { kind: "rejected" };
  if (typeof payload.exp !== "number") return { kind: "rejected" };
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { kind: "rejected" };
  }

  const issuer = `https://securetoken.google.com/${config.projectId}`;
  if (payload.iss !== issuer) return { kind: "rejected" };
  if (payload.aud !== config.projectId) return { kind: "rejected" };

  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return { kind: "rejected" };

  const jwks = await fetchFirebaseJwks();
  if (jwks.kind === "unavailable") return { kind: "unavailable" };

  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) return { kind: "rejected" };

  const ok = await verifyRs256(token, jwk);
  return ok ? { kind: "ok", user: { id: payload.sub } } : { kind: "rejected" };
}
