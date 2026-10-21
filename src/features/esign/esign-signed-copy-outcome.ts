/**
 * What the download route should do with the compose callable's answer.
 *
 * Pure and separate from the route so the one branch that matters — HR has not
 * counter-signed yet, so the signed copy cannot exist — is testable without a
 * Next request. `awaiting_counter_signature` is not a failure: answering 404 for
 * it is what told an admin the document did not exist.
 */
export type SignedCopyOutcome =
  | { status: "ready" }
  | { status: "awaiting" }
  | { status: "failed"; error: string };

export const AWAITING_COUNTER_SIGNATURE = "awaiting_counter_signature";

export function signedCopyOutcome(input: {
  error: { message: string } | null;
  data: Record<string, unknown> | null;
}): SignedCopyOutcome {
  if (input.error) return { status: "failed", error: input.error.message };
  const payload = input.data ?? {};
  if (payload.ok !== false) return { status: "ready" };
  const code = String(payload.error ?? "compose_failed");
  return code === AWAITING_COUNTER_SIGNATURE
    ? { status: "awaiting" }
    : { status: "failed", error: code };
}
