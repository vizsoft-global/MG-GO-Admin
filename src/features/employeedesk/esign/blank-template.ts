import type { EsignTemplateDetail } from "@/features/esign/types";

/**
 * The starting document for `/employeedesk/esign/templates/new`.
 *
 * It deliberately has no id: the builder reads an absent id as "insert on save",
 * which is the same branch the upsert RPC already takes for a new template. The
 * empty `id` is never written anywhere — the builder passes `undefined` to the
 * RPC and adopts the id the insert returns.
 *
 * The seed copy is the shape of a real disciplinary letter, because an author
 * starts from something and edits rather than from a blank page, and the preview
 * needs a document to draw on the first frame.
 *
 * `category_key` is deliberately empty rather than a plausible-looking literal.
 * Categories are rows in `esign_categories` and nothing here can read them, so a
 * hardcoded key is a guess that goes stale the moment an operator renames or
 * deletes it — and it fails *silently*, because a `Select` whose value has no
 * matching option paints the raw key instead of a label. `resolveEsignCategoryKey`
 * picks a real one from the live list at the render boundary.
 */
export function blankEsignTemplate(): EsignTemplateDetail {
  return {
    id: "",
    category_key: "",
    name_en: "",
    name_ar: null,
    header_en: "MUSALLAM DELIVERY",
    header_ar: "مسلم للتوصيل",
    body_en: "Notice of disciplinary action",
    body_ar: "إشعار بإجراء تأديبي",
    declaration_en:
      "I acknowledge that the details above have been explained to me, and that I have received a copy of this document.",
    declaration_ar:
      "أقر بأن التفاصيل أعلاه قد تم شرحها لي، وأنني استلمت نسخة من هذا المستند.",
    default_language: "en",
    is_active: false,
    document_kind: "penalty",
    is_draft: true,
    version: 1,
    created_at: "",
    updated_at: "",
    field_count: 0,
    fields: [],
  };
}

/**
 * Pick a category key the builder's `Select` can actually render.
 *
 * `esign_templates.category_key` is free text (no FK), and the builder's options
 * come from the live `esign_categories` rows, so a template can name a category
 * that has been deleted, renamed or never existed. Base UI renders a value with no
 * matching option as the raw value — which is how the literal string `penalty`
 * appeared in a trigger where every other row showed a human label — so the mismatch
 * is invisible in the DB and obvious only to whoever opens the page.
 *
 * Returning the first live category when the preferred one is absent keeps the
 * control honest: whatever the trigger shows, an operator can also choose it. It
 * never invents an option, so an empty catalogue yields an empty string rather than
 * a key that does not exist.
 */
export function resolveEsignCategoryKey(
  preferred: string | null | undefined,
  options: readonly { key: string }[],
): string {
  const wanted = (preferred ?? "").trim();
  if (wanted && options.some((option) => option.key === wanted)) return wanted;
  return options[0]?.key ?? wanted;
}
