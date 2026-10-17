export const SHEET_EDITED_MARKER = "<!-- esign-sheet-edited -->";

const MAX_SHEET_HTML_CHARS = 1_500_000;

function stripWrapped(html: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return html.replace(pattern, "");
}

/** Keeps a staff edit of the frozen sheet, and drops anything that can run. */
export function sanitizeEditedSheetHtml(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let html = raw.replace(/^\uFEFF/, "").trim();
  if (html.length === 0 || html.length > MAX_SHEET_HTML_CHARS) return null;
  const looksLikeSheet =
    html.includes("data-slot-role") ||
    html.includes('class="page"') ||
    html.includes("class='page'");
  if (!looksLikeSheet) return null;

  html = stripWrapped(html, "script");
  html = stripWrapped(html, "iframe");
  html = stripWrapped(html, "object");
  html = html.replace(/<embed\b[^>]*\/?>/gi, "");
  html = html.replace(
    /<style\b[^>]*\bid=["'](?:stamp-fit-style|form-edit-style)["'][^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\scontenteditable\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\sdata-form-edit\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/javascript\s*:/gi, "");

  if (!html.includes("esign-sheet-edited")) {
    html = `${SHEET_EDITED_MARKER}\n${html}`;
  }
  if (html.length > MAX_SHEET_HTML_CHARS) return null;
  if (!html.includes("data-slot-role") && !html.includes("page")) return null;
  return html;
}
