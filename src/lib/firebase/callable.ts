import "server-only";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "./admin";
import { getFirebaseAdminConfig } from "./config";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "./db";
import { staffDb } from "./staff-db";
import {
  MIDDLEWARE_SESSION_BUDGET_MS,
  STAFF_SESSION_COOKIE,
  verifyStaffSessionCookie,
} from "./session";

/**
 * Server-side caller for the ported Cloud Functions.
 *
 * The panel authenticates with a Firebase *session cookie*, and a callable
 * verifies a Firebase *ID token* â€” different artefacts. Minting the ID token
 * here (custom token â†’ `signInWithCustomToken`) is the documented way to bridge
 * the two without shipping the web client SDK into a server action, and it keeps
 * the admin's own identity: the token is minted for the uid the cookie already
 * proved, so a callable's `requireStaff` sees the same caller the proxy did.
 *
 * The result shape is deliberately the one the Supabase client returned â€”
 * `{ data, error }` with `error.message` carrying the SQL error string â€” so a
 * call site changes by one word (`.rpc` â†’ `callAdminFunction`) and every
 * `if (error) return { error: error.message }` branch in the panel keeps working.
 */

export type AdminFunctionResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

/** Callables for a heavy report can legitimately run for a minute. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Firebase ID tokens live for an hour; refresh a little before that. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

type CachedToken = { token: string; expiresAt: number };

/**
 * Per-instance token cache, keyed by uid.
 *
 * A serverless instance is short-lived, so this is a bonus rather than a
 * guarantee: the worst case is one extra custom-token exchange per call, which is
 * two HTTPS round trips to Google, not a correctness problem.
 */
const tokenCache = new Map<string, CachedToken>();

export type AdminFunctionOptions = { timeoutMs?: number };

/** `admin_list_requests` â†’ `adminListRequests`, the export name in `functions/src`. */
export function functionName(rpcName: string): string {
  if (!rpcName.includes("_")) return rpcName;
  return rpcName.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function functionsRegion(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() || "me-central1";
}

function functionsBaseUrl(projectId: string): string {
  return `https://${functionsRegion()}-${projectId}.cloudfunctions.net`;
}

/**
 * Exchanges a custom token for an ID token.
 *
 * Returns null when the web API key or the service account is absent â€” the panel
 * is then unable to call functions at all, which must read as a configuration
 * failure, not as a permission one.
 */
async function mintIdToken(uid: string): Promise<CachedToken | null> {
  const cached = tokenCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const auth = await getFirebaseAuth();
  if (!apiKey || !auth) return null;

  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
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

  const entry = { token: body.idToken, expiresAt: Date.now() + TOKEN_TTL_MS };
  tokenCache.set(uid, entry);
  return entry;
}

/** Test seam. */
export function clearAdminFunctionTokenCache(): void {
  tokenCache.clear();
}

async function callerUid(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: MIDDLEWARE_SESSION_BUDGET_MS,
  });
  return probe.uid;
}

function parseCallableBody(raw: unknown): {
  result?: unknown;
  error?: { message?: string; status?: string };
} | null {
  return typeof raw === "object" && raw !== null
    ? (raw as { result?: unknown; error?: { message?: string; status?: string } })
    : null;
}

function errorMessageOf(
  body: { error?: { message?: string; status?: string } } | null,
  status: number,
): string {
  // A HttpsError carries the SQL error string as its message, which is what the
  // panel already shows; the status is only the fallback.
  return body?.error?.message ?? body?.error?.status ?? `http_${status}`;
}

async function postCallable<T>(
  projectId: string,
  rpcName: string,
  args: Record<string, unknown>,
  idToken: string,
  options: AdminFunctionOptions,
): Promise<AdminFunctionResult<T>> {
  const response = await fetch(`${functionsBaseUrl(projectId)}/${functionName(rpcName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: args }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  }).catch(() => null);

  if (!response) return { data: null, error: { message: "unavailable" } };

  const body = parseCallableBody(await response.json().catch(() => null));
  if (!response.ok || body?.error) {
    return {
      data: null,
      error: {
        message: errorMessageOf(body, response.status),
        code: String(response.status),
      },
    };
  }
  return { data: (body?.result ?? null) as T | null, error: null };
}

/**
 * Invokes a ported admin RPC.
 *
 * `rpcName` is the SQL name the panel already passes (`admin_save_payroll_client`);
 * argument names are left exactly as the call site wrote them, because every
 * callable accepts both the `p_snake_case` and the camelCase spelling.
 */
export async function callAdminFunction<T = unknown>(
  rpcName: string,
  args: Record<string, unknown> = {},
  options: AdminFunctionOptions = {},
): Promise<AdminFunctionResult<T>> {
  const config = getFirebaseAdminConfig();
  if (!config) return { data: null, error: { message: "not_configured" } };

  const uid = await callerUid();
  if (!uid) return { data: null, error: { message: "not_authenticated" } };

  const token = await mintIdToken(uid);
  if (!token) return { data: null, error: { message: "not_configured" } };

  const attempt = await postCallable<T>(config.projectId, rpcName, args, token.token, options);
  if (!attempt.error) return attempt;

  // A token the callable has already rejected is the one failure worth retrying:
  // the call is idempotent from the caller's point of view, and one extra attempt
  // turns a rare rotation into a non-event rather than a failed save.
  const status = Number(attempt.error.code ?? 0);
  if (status !== 401 && status !== 403) return attempt;

  tokenCache.delete(uid);
  const retry = await mintIdToken(uid);
  if (!retry) return attempt;
  return postCallable<T>(config.projectId, rpcName, args, retry.token, options);
}

/**
 * Vercel crons carry the shared secret, not a staff session cookie. They call as
 * the super admin on `app_settings/1.super_admin_user_id` with the `superAdmin`
 * claim â€” the identity the SQL service-role crons acted as.
 */
export async function callCronFunction<T = unknown>(
  rpcName: string,
  args: Record<string, unknown> = {},
  options: AdminFunctionOptions = {},
): Promise<AdminFunctionResult<T>> {
  const config = getFirebaseAdminConfig();
  const db = await staffDb();
  const auth = await getFirebaseAuth();
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!config || !db || !auth || !apiKey) return { data: null, error: { message: "not_configured" } };

  const settings = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const uid = settings.data()?.super_admin_user_id;
  if (typeof uid !== "string" || !uid) return { data: null, error: { message: "not_configured" } };

  const customToken = await auth.createCustomToken(uid, { staff: true, superAdmin: true });
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  if (!response?.ok) return { data: null, error: { message: "not_configured" } };
  const body = (await response.json().catch(() => null)) as { idToken?: string } | null;
  if (!body?.idToken) return { data: null, error: { message: "not_configured" } };

  return postCallable<T>(config.projectId, rpcName, args, body.idToken, options);
}

