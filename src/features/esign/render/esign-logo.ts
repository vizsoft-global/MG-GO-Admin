import { escapeHtml } from "./esign-placeholders";

/**
 * The one place a document header turns a resolved logo URL into markup.
 *
 * The URL arriving here is already a browser-loadable one — a presigned R2 GET
 * or an app-branding URL — so this only decides whether there is anything to
 * print. Returning "" for a missing logo is what lets every sheet keep its
 * layout exactly as it was when no company logo is configured.
 */
export function logoImageHtml(
  logoUrl: string | null | undefined,
  className = "doc-logo",
  alt = "",
): string {
  const trimmed = logoUrl?.trim() ?? "";
  if (!trimmed) return "";
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(trimmed)}" alt="${escapeHtml(alt)}"/>`;
}
