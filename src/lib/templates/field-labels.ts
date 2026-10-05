/**
 * Canonical personal-information field catalogue.
 *
 * One place decides what a personal-information column is called in English
 * and Arabic, so an import template, an export sheet, an e-sign template and a
 * payroll report cannot drift apart and start disagreeing about the same fact.
 *
 * The rule for consumers:
 *   - Write headers with `canonicalLabel(key, locale)`.
 *   - Match imported headers with `matchCanonicalKey(header)`, which still
 *     accepts every legacy alias, so sheets produced by older builds keep
 *     working.
 *
 * Adding a field means adding one entry here, not editing four templates.
 */

export type CanonicalFieldKey =
  | "date"
  | "employee_code"
  | "employee_name"
  | "company_name"
  | "position"
  | "joining_date";

export type CanonicalField = {
  key: CanonicalFieldKey;
  en: string;
  ar: string;
  /**
   * Lower-cased header spellings accepted on import, including the historical
   * names different modules shipped with. The canonical EN/AR labels are always
   * accepted on top of these.
   */
  aliases: readonly string[];
};

export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  {
    key: "date",
    en: "Date",
    ar: "التاريخ",
    aliases: ["day", "work date", "shift date", "earn date"],
  },
  {
    key: "employee_code",
    en: "Employee Code",
    ar: "كود الموظف",
    aliases: [
      "employee id",
      "emp id",
      "mg id",
      "driver id",
      "driver code",
      "rider id",
      "staff id",
    ],
  },
  {
    key: "employee_name",
    en: "Employee Name",
    ar: "اسم الموظف",
    aliases: ["full name", "name", "driver name", "rider name", "staff name"],
  },
  {
    key: "company_name",
    en: "Company Name",
    ar: "اسم الشركة",
    aliases: ["company", "client name", "platform", "employer"],
  },
  {
    key: "position",
    en: "Position",
    ar: "المنصب",
    aliases: ["job title", "role", "designation", "category"],
  },
  {
    key: "joining_date",
    en: "Joining Date",
    ar: "تاريخ الانضمام",
    aliases: ["join date", "hired date", "hire date", "start date", "date joined"],
  },
] as const;

const BY_KEY: Record<CanonicalFieldKey, CanonicalField> = CANONICAL_FIELDS.reduce(
  (acc, field) => {
    acc[field.key] = field;
    return acc;
  },
  {} as Record<CanonicalFieldKey, CanonicalField>,
);

export type TemplateLocale = "en" | "ar";

/** Human-readable label for a canonical field in the given locale. */
export function canonicalLabel(
  key: CanonicalFieldKey,
  locale: TemplateLocale = "en",
): string {
  const field = BY_KEY[key];
  return locale === "ar" ? field.ar : field.en;
}

function normalize(header: string): string {
  return header
    .toLowerCase()
    .replace(/[*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every spelling that resolves to this key: canonical EN/AR + aliases. */
function needlesFor(field: CanonicalField): string[] {
  return [field.en, field.ar, ...field.aliases].map(normalize);
}

/**
 * Resolve an imported header to a canonical key, or null when it is not a
 * personal-information column. Legacy aliases are honoured, so a sheet written
 * before this catalogue existed still maps.
 */
export function matchCanonicalKey(header: string): CanonicalFieldKey | null {
  const needle = normalize(header);
  if (!needle) return null;
  for (const field of CANONICAL_FIELDS) {
    if (needlesFor(field).includes(needle)) return field.key;
  }
  return null;
}

/** All resolve targets for a key, canonical first — useful for fuzzy matching. */
export function canonicalHeaderAliases(key: CanonicalFieldKey): string[] {
  const field = BY_KEY[key];
  return [field.en, field.ar, ...field.aliases];
}

/**
 * `employee_name` / `Employee Name` / `اسم الموظف` → a printable label.
 *
 * The reverse of `matchCanonicalKey`, and it exists because of where keys come
 * from. A stored field key is not a header: `esign_template_fields.field_key`
 * is snake_case by convention, while an imported spreadsheet column carries the
 * human spelling. So a caller holding a *key* — a repair form, a stored
 * `field_values` map, a CSV of an existing record — cannot run the input
 * matcher directly or `employee_name` resolves to nothing and falls through to
 * the humaniser, printing "Employee name" beside a field the catalogue has a
 * real Arabic label for. Normalising the underscores to spaces first is what
 * makes one catalogue answer both directions.
 *
 * Falls back to the de-snaked key rather than to null: a template may carry a
 * column the catalogue has never heard of, and an operator editing it needs to
 * see *something* better than a blank label.
 */
export function labelForKey(key: string, locale: TemplateLocale = "en"): string {
  const canonical = matchCanonicalKey(key) ?? matchCanonicalKey(key.replace(/[_-]+/g, " "));
  if (canonical) return canonicalLabel(canonical, locale);
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Header row for an export/import sheet in the requested locale. */
export function canonicalHeaderRow(
  keys: readonly CanonicalFieldKey[],
  locale: TemplateLocale = "en",
): string[] {
  return keys.map((key) => canonicalLabel(key, locale));
}
