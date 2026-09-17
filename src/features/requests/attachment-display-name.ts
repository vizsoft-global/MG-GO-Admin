/** Basename only — camera paths must not stretch the attachment row. */
export function attachmentDisplayName(
  fileName: string | null | undefined,
  storageKey?: string | null,
): string {
  const raw = (fileName ?? "").trim() || (storageKey ?? "").trim();
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? raw;
  return base.replace(/\s+/g, " ").trim() || "attachment";
}
