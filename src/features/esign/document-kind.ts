import { ESIGN_DOCUMENT_KINDS, type EsignDocumentKind } from "./types";

/**
 * Read a `document_kind` off a database row, or fall back to `general`.
 *
 * **This exists because the same allowlist was written out twice.** The type
 * union, the builder's picker and the `esign_templates_document_kind_check`
 * constraint all learned `payslip` together; `mapTemplate` kept its own literal
 * `["penalty", "loan", "general"]` and quietly rewrote every payslip template to
 * `general` on the way out of the database. The builder then rendered the plain
 * `general` skeleton for a template the database said was a payslip — and a
 * silently coerced kind is worse than a rejected one, because the page still
 * looks like a working builder while drawing the wrong document. Nothing failed,
 * so nothing was noticed until panel C2 was compared against the screen.
 *
 * Deriving from `ESIGN_DOCUMENT_KINDS` is the fix rather than adding the missing
 * string: with one list, the next kind cannot half-land. The fallback stays
 * `general` because a row written before the constraint existed is a plain body,
 * and because `general` is the renderer's own default.
 */
export function normalizeDocumentKind(value: unknown): EsignDocumentKind {
  const kind = String(value ?? "");
  return (ESIGN_DOCUMENT_KINDS as readonly string[]).includes(kind)
    ? (kind as EsignDocumentKind)
    : "general";
}
