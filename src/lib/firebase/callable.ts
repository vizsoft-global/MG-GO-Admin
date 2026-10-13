import "server-only";
import { cookies } from "next/headers";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { getFirebaseAuth } from "./admin";
import { isMutatingAdminRpc } from "./mutating-rpc";
import { getFirebaseAdminConfig } from "./config";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "./db";
import { staffDb } from "./staff-db";
import {
  MIDDLEWARE_SESSION_BUDGET_MS,
  STAFF_SESSION_COOKIE,
  verifyStaffSessionCookie,
} from "./session";
import { resolveAdminCallableRequest } from "./callable-route";
import { clearIdTokenCache, forgetIdToken, loadCachedIdToken } from "./callable-token";

export { functionName } from "./callable-route";

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

export type AdminFunctionOptions = { timeoutMs?: number };

function functionsRegion(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() || "me-central1";
}

/**
 * Exchanges a custom token for an ID token.
 *
 * Returns null when the web API key or the service account is absent — the panel
 * is then unable to call functions at all, which must read as a configuration
 * failure, not as a permission one. The cache is shared with cron mints and is
 * keyed by uid; cron uses a separate key so a session token is not reused.
 */
async function mintIdToken(uid: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const auth = await getFirebaseAuth();
  if (!apiKey || !auth) return null;
  return loadCachedIdToken({
    uid,
    kind: "session",
    apiKey,
    createCustomToken: () => auth.createCustomToken(uid),
  });
}

/** Test seam. */
export function clearAdminFunctionTokenCache(): void {
  clearIdTokenCache();
}

/**
 * Drops the minted callable ID token for one uid.
 * revokeStaffAccess is the only caller. Stage B owns the rest of this file.
 */
export function clearMintedIdToken(uid: string): void {
  forgetIdToken(uid, "session");
  forgetIdToken(uid, "cron");
}

async function callerUid(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: MIDDLEWARE_SESSION_BUDGET_MS,
    // Reads do not check revocation. Mutations go through requireMutationAuth.
    checkRevoked: false,
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

/** One line per call. Name, duration, status, attempt, lane. Never the payload or token. */
function logCallableTiming(
  name: string,
  ms: number,
  status: string,
  attempt: number,
  lane: string | null,
): void {
  const safe = status.replace(/[\r\n]/g, " ").slice(0, 80);
  console.info(JSON.stringify({ perf: "callable", name, ms, status: safe, attempt, lane }));
}

async function postCallable<T>(
  projectId: string,
  rpcName: string,
  args: Record<string, unknown>,
  idToken: string,
  options: AdminFunctionOptions,
  attempt: number,
): Promise<AdminFunctionResult<T>> {
  const started = Date.now();
  const route = resolveAdminCallableRequest({
    routerMode: process.env.ADMIN_API_ROUTER,
    projectId,
    region: functionsRegion(),
    rpcName,
    args,
    timeoutMs: options.timeoutMs,
  });
  const response = await fetch(route.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(route.body),
    signal: AbortSignal.timeout(route.timeoutMs),
  }).catch(() => null);

  if (!response) {
    logCallableTiming(route.functionName, Date.now() - started, "unavailable", attempt, route.lane);
    return { data: null, error: { message: "unavailable" } };
  }

  const body = parseCallableBody(await response.json().catch(() => null));
  if (!response.ok || body?.error) {
    const message = errorMessageOf(body, response.status);
    logCallableTiming(route.functionName, Date.now() - started, message, attempt, route.lane);
    return {
      data: null,
      error: {
        message,
        code: String(response.status),
      },
    };
  }
  logCallableTiming(route.functionName, Date.now() - started, "ok", attempt, route.lane);
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

  let uid: string | null;
  if (isMutatingAdminRpc(rpcName)) {
    const mutationAuth = await requireMutationAuth();
    if ("error" in mutationAuth) {
      return { data: null, error: { message: mutationAuth.error } };
    }
    uid = mutationAuth.session.id;
  } else {
    uid = await callerUid();
  }
  if (!uid) return { data: null, error: { message: "not_authenticated" } };

  const token = await mintIdToken(uid);
  if (!token) return { data: null, error: { message: "not_configured" } };

  const attempt = await postCallable<T>(config.projectId, rpcName, args, token, options, 1);
  if (!attempt.error) return attempt;

  // A token the callable has already rejected is the one failure worth retrying:
  // the call is idempotent from the caller's point of view, and one extra attempt
  // turns a rare rotation into a non-event rather than a failed save.
  const status = Number(attempt.error.code ?? 0);
  if (status !== 401 && status !== 403) return attempt;

  forgetIdToken(uid, "session");
  const retry = await mintIdToken(uid);
  if (!retry) return attempt;
  return postCallable<T>(config.projectId, rpcName, args, retry, options, 2);
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

  const idToken = await loadCachedIdToken({
    uid,
    kind: "cron",
    apiKey,
    createCustomToken: () => auth.createCustomToken(uid, { staff: true, superAdmin: true }),
  });
  if (!idToken) return { data: null, error: { message: "not_configured" } };

  return postCallable<T>(config.projectId, rpcName, args, idToken, options, 1);
}

