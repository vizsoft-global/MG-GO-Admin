import type { SupabaseClient, User } from "@supabase/supabase-js";
import { withDeadline } from "@/lib/supabase/deadline";

/**
 * `getUser()` returns `{ user: null }` for a missing session *and* for a
 * gateway failure, so a saturated backend is indistinguishable from a signed
 * out admin unless the error is inspected.
 */
export type AuthProbe = {
  user: User | null;
  /** The session could not be verified. It is unproven, not absent. */
  unavailable: boolean;
};

/** Statuses auth-js maps to AuthRetryableFetchError, plus Cloudflare 525/526. */
const INFRASTRUCTURE_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530,
]);

/** Beyond this a second attempt risks the whole function budget. */
const RETRY_IF_FAILED_WITHIN_MS = 1_200;
const RETRY_DELAY_MS = 150;

function isInfrastructureFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { name, status } = error as { name?: string; status?: number };

  // An absent or revoked session is a real answer, not a failure to answer.
  if (name === "AuthSessionMissingError") return false;

  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError") {
    return true;
  }

  return typeof status === "number" && INFRASTRUCTURE_STATUSES.has(status);
}

/**
 * Verifies the caller, retrying once when the first attempt failed fast.
 *
 * A slow failure is left alone: a 522 surfaces after ~15s, and a second wait
 * would spend the serverless budget rather than the session.
 *
 * `timeoutMs` bounds the probe as a whole, retry included. Callers on a hard
 * budget (the proxy, which Vercel terminates at 25s) must set it; an expiry is
 * reported as unavailable, since a probe that did not finish proves nothing
 * about the session.
 */
export async function probeUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  options: { timeoutMs?: number } = {},
): Promise<AuthProbe> {
  const attempt = runProbe(supabase);

  return options.timeoutMs === undefined
    ? attempt
    : withDeadline(attempt, options.timeoutMs, () => ({
        user: null,
        unavailable: true,
      }));
}

async function runProbe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<AuthProbe> {
  const startedAt = Date.now();

  try {
    const { data, error } = await supabase.auth.getUser();

    if (!isInfrastructureFailure(error)) {
      return { user: data.user ?? null, unavailable: false };
    }

    if (Date.now() - startedAt > RETRY_IF_FAILED_WITHIN_MS) {
      return { user: null, unavailable: true };
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    const retry = await supabase.auth.getUser();

    if (!isInfrastructureFailure(retry.error)) {
      return { user: retry.data.user ?? null, unavailable: false };
    }

    return { user: null, unavailable: true };
  } catch {
    // getUser() only throws for non-auth errors (e.g. the fetch layer itself).
    return { user: null, unavailable: true };
  }
}
