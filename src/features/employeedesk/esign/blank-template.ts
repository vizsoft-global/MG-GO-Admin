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
 */
export function blankEsignTemplate(): EsignTemplateDetail {
  return {
    id: "",
    category_key: "penalty",
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
