/**
 * The Order Comparison page's own error vocabulary.
 *
 * `getOrderComparison` used to collapse every backend failure into
 * `compare_failed`, and the message under it told the operator the RPC was "not
 * live until Approve, deploy" — even when the real answer was a 403, a capped
 * scan or a stale lane. These keys are the contract between the server action,
 * the page copy and the tests; the page renders `pages.orderRecon.errors.<key>`.
 */
export const COMPARISON_ERROR_KEYS = [
  "invalid_range",
  "range_too_large",
  "scan_cap_exceeded",
  "not_authorized",
  "not_configured",
  "service_stale",
  "service_unavailable",
  "compare_failed",
  "request_failed",
] as const;

export type ComparisonErrorKey = (typeof COMPARISON_ERROR_KEYS)[number];

export function isComparisonErrorKey(value: string): value is ComparisonErrorKey {
  return (COMPARISON_ERROR_KEYS as readonly string[]).includes(value);
}

/**
 * A scan that would read more documents than the page allows.
 *
 * Thrown inside the fallback reader so the server action can answer
 * `scan_cap_exceeded` — "pick a shorter range" — instead of a generic failure.
 */
export class ComparisonReadCapError extends Error {
  constructor() {
    super("scan_cap_exceeded");
    this.name = "ComparisonReadCapError";
  }
}

/** Keys a callable's `HttpsError` message can carry through verbatim. */
const DIRECT_CODES: Record<string, ComparisonErrorKey> = {
  invalid_range: "invalid_range",
  range_too_large: "range_too_large",
  scan_cap_exceeded: "scan_cap_exceeded",
  not_authorized: "not_authorized",
  not_configured: "not_configured",
};

/**
 * Which error the page should show for one `callAdminFunction` failure.
 *
 * - a known domain code is preserved (`range_too_large`, `scan_cap_exceeded`, …)
 * - `wrong_lane`, a missing export or "could not find the function" means the
 *   deployed lane is behind the client → `service_stale`
 * - any HTTP 5xx → `service_unavailable`
 * - everything else (401/403 from the invoker, HTML errors, …) → `compare_failed`
 *
 * `service_stale` is also the only key that permits the local fallback read.
 */
export function failureCode(
  error: { code?: string | null; message?: string | null } | null | undefined,
): ComparisonErrorKey {
  const message = (error?.message ?? "").trim();
  const direct = DIRECT_CODES[message];
  if (direct) return direct;
  if (message === "wrong_lane") return "service_stale";
  // The lane router answers `unknown_fn` when the name is not in the deployed
  // lane, and a legacy 404 says "could not find the function".
  if (message === "unknown_fn") return "service_stale";
  const lower = message.toLowerCase();
  if (
    message.includes("admin_order_comparison_snapshot") ||
    message.includes("admin_order_recon_compare") ||
    lower.includes("could not find the function")
  ) {
    return "service_stale";
  }
  // `callAdminFunction` labels a timed-out / aborted fetch this way.
  if (message === "unavailable") return "request_failed";
  const code = (error?.code ?? "").trim();
  if (code.startsWith("5")) return "service_unavailable";
  return "compare_failed";
}

/**
 * The key the page renders from a thrown server-action error.
 *
 * The action throws `new Error(<key>)`, so an exact key is returned as-is. A
 * transport error or anything unexpected falls back to `compare_failed`; the
 * page must never print a raw stack or an empty box.
 */
export function comparisonErrorKeyFromMessage(
  error: unknown,
): ComparisonErrorKey {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const trimmed = message.trim();
  return isComparisonErrorKey(trimmed) ? trimmed : "compare_failed";
}
