export const SESSION_UNPROVEN = "session_unproven";

export class SessionUnprovenError extends Error {
  constructor() {
    super(SESSION_UNPROVEN);
    this.name = "SessionUnprovenError";
  }
}

export function isSessionUnprovenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  if (
    name === "SessionUnprovenError" ||
    name === "TimeoutError" ||
    name === "AbortError"
  ) {
    return true;
  }
  return (
    message === SESSION_UNPROVEN ||
    message === "auth_backend_unavailable" ||
    /timed?\s*out|did not answer|auth_backend_unavailable|session_unproven/i.test(
      message,
    )
  );
}
