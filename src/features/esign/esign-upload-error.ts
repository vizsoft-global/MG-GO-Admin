export type EsignUploadErrorCode =
  | "not_configured"
  | "storage_bucket_missing"
  | "already_exists"
  | "upload_failed";

function textOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message ?? "");
  }
  return "";
}

/**
 * Maps R2 / GCS upload failures. Never classifies `unknown_fn`,
 * `unknown_id`, or a router miss as a bucket problem.
 */
export function classifyEsignUploadError(error: unknown): EsignUploadErrorCode {
  const raw = textOf(error);
  const message = raw.toLowerCase();
  if (!raw) return "upload_failed";
  if (
    message === "not_configured" ||
    message.includes("not_configured") ||
    message.includes("r2 is not configured")
  ) {
    return "not_configured";
  }
  if (message === "already_exists") return "already_exists";
  if (
    message.includes("unknown_fn") ||
    message.includes("wrong_lane") ||
    message.includes("unknown_id")
  ) {
    return "upload_failed";
  }
  if (
    message.includes("the specified bucket does not exist") ||
    message.includes("bucket does not exist") ||
    message.includes("nosuchbucket") ||
    (message.includes("404") && message.includes("bucket")) ||
    message.includes("storage_bucket_missing")
  ) {
    return "storage_bucket_missing";
  }
  return "upload_failed";
}
