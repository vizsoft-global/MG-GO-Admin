import type { EsignFieldSource, EsignTemplateFieldType } from "./types";

/**
 * The template builder's *source badge* vocabulary.
 *
 * The reference design puts one badge on every field row saying where the value
 * comes from — "From the system", "You enter", "Fixed", "Signed by a person" —
 * and that badge is the thing an author actually reads when deciding whether a
 * field belongs in a template. It is deliberately **not** derived from
 * `field_type`: a date a human types and a date the system stamps are both
 * `date`, and giving them the same badge is exactly the confusion the badge
 * exists to remove. So provenance is stored on the row (`source_kind`) and the
 * badge reads it.
 *
 * The signature *blocks* in the document footer are not field rows at all —
 * they are part of the skeleton the preview draws for a penalty or loan
 * document, because every such document is signed by the employee and by HR.
 * What `source_kind = 'signature'` marks is a row whose **value** is signed off
 * by a person (a signature date, a countersigned name), which is why it is
 * offered for ordinary field types rather than being its own type.
 */

export type FieldSourceTone = "system" | "entry" | "fixed" | "signature";

export type FieldSourceMeta = {
  /** i18n key under `pages.employeedesk.esign.templateBuilder.sources`. */
  labelKey: string;
  /**
   * Badge classes. Same palette discipline as the rest of the panel: a
   * state-carrying tint, never `primary/10` for a group of badges.
   */
  className: string;
  tone: FieldSourceTone;
};

export const FIELD_SOURCE_META: Record<EsignFieldSource, FieldSourceMeta> = {
  // System-filled is the calm one — the author does not have to do anything.
  system: {
    labelKey: "fromSystem",
    className: "border-sky-200 bg-sky-50 text-sky-800",
    tone: "system",
  },
  // The operator's own work, so it reads as the informative accent.
  entry: {
    labelKey: "youEnter",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    tone: "entry",
  },
  // A constant baked into the document — neutral, not attention-seeking.
  fixed: {
    labelKey: "fixed",
    className: "border-border bg-muted/50 text-muted-foreground",
    tone: "fixed",
  },
  // Legally the heaviest row in the document, so it gets the success tint.
  signature: {
    labelKey: "signedByPerson",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    tone: "signature",
  },
};

/** The badge a field row must show. An unknown value falls back to `entry`. */
export function resolveFieldSource(field: {
  source_kind?: EsignFieldSource | null;
}): EsignFieldSource {
  const kind = field.source_kind;
  if (kind && kind in FIELD_SOURCE_META) return kind;
  return "entry";
}

/**
 * A field row's own label, in the language the caller is reading.
 *
 * One function rather than the `locale === "ar" ? (f.label_ar || f.label_en) :
 * f.label_en` expression written out at each call site. The fallback matters:
 * `label_ar` is optional, and a row authored in English only has to keep
 * printing its English label in the Arabic UI rather than an empty chip.
 */
export function templateFieldLabel(
  field: { label_en: string; label_ar?: string | null },
  locale: string,
): string {
  if (locale === "ar") return field.label_ar || field.label_en;
  return field.label_en;
}

/** Field types a template author may choose, in the order the builder lists them. */
export const ESIGN_FIELD_TYPE_ORDER: EsignTemplateFieldType[] = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
];

/** Source options an author may pick, in the order the builder lists them. */
export const ESIGN_FIELD_SOURCE_ORDER: EsignFieldSource[] = [
  "system",
  "entry",
  "fixed",
  "signature",
];

/**
 * Whether a (source, type) pair is one the document can actually render.
 *
 * Two refusals, and both are mirrored by the server in
 * `admin_upsert_esign_template_field` so a hand-crafted request cannot create a
 * pair the builder would not:
 *
 * - **Fixed needs a value.** "Fixed" means the value is baked into the
 *   document, and the only place a fixed value is stored is the options list.
 *   Fixed with no options renders an empty row, so it is refused rather than
 *   silently producing a blank line on a signed document.
 * - **A dropdown is not a signature.** There is no field type that can capture a
 *   stroke, so a `select` marked "Signed by a person" would print a signature
 *   badge over a picker.
 */
export function isFieldPairRenderable(
  source: EsignFieldSource,
  fieldType: EsignTemplateFieldType,
  optionCount: number,
): boolean {
  if (source === "fixed" && optionCount < 1) return false;
  if (source === "signature" && fieldType === "select") return false;
  return true;
}

/** i18n key under `…templateBuilder.errors` for a refused pair. */
export function fieldPairErrorKey(
  source: EsignFieldSource,
  fieldType: EsignTemplateFieldType,
  optionCount: number,
): "fixedNeedsValue" | "signatureNotDropdown" | null {
  if (source === "fixed" && optionCount < 1) return "fixedNeedsValue";
  if (source === "signature" && fieldType === "select") return "signatureNotDropdown";
  return null;
}
