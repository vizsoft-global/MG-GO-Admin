export type EsignResolveErrorCode =
  | "unknown_fn"
  | "wrong_lane"
  | "unknown_id"
  | "not_authorized"
  | "ambiguous"
  | "archived"
  | "blocked"
  | "failed";

function textOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message ?? "");
  }
  return "";
}

/**
 * Resolve / router failures. A bucket miss must not land here.
 */
export function classifyEsignResolveError(error: unknown): EsignResolveErrorCode {
  const message = textOf(error).toLowerCase();
  if (message.includes("storage_bucket") || message.includes("bucket does not exist")) {
    return "failed";
  }
  if (message.includes("unknown_fn")) return "unknown_fn";
  if (message.includes("wrong_lane")) return "wrong_lane";
  if (message.includes("unknown_id")) return "unknown_id";
  if (message.includes("ambiguous")) return "ambiguous";
  if (message.includes("archived")) return "archived";
  if (message.includes("blocked")) return "blocked";
  if (message.includes("not_authorized") || message.includes("permission-denied")) {
    return "not_authorized";
  }
  return "failed";
}

export const ESIGN_MAPPED_ERROR_KEYS = [
  "not_configured",
  "storage_bucket_missing",
  "unknown_fn",
  "wrong_lane",
  "unknown_id",
  "not_authorized",
  "field_required",
  "ambiguous",
  "archived",
  "blocked",
] as const;

export function mappedEsignErrorKey(code: string | undefined | null): string | null {
  if (!code) return null;
  return (ESIGN_MAPPED_ERROR_KEYS as readonly string[]).includes(code) ? code : null;
}
