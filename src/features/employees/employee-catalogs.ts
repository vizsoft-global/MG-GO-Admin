export const CATALOG_KEY_RE = /^[a-z0-9_]{1,40}$/;

export type EmployeeCatalogKind =
  | "employee_statuses"
  | "employee_sections"
  | "nationality_categories"
  | "bank_codes"
  | "sponsorships";

export type EmployeeCatalogRow = {
  key: string;
  label_en: string;
  label_ar: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
  color?: string | null;
  is_nbk?: boolean;
  /**
   * `employee_sections` only. False means a rider in this section never needs a
   * zone or a restaurant: the app clocks in without an assignment gate, and
   * approval/activation must not refuse them for a missing one. Absent = true,
   * so every existing row keeps today's behaviour.
   */
  is_operational?: boolean;
};

export const DEFAULT_EMPLOYEE_STATUSES: readonly EmployeeCatalogRow[] = [
  { key: "new", label_en: "New", label_ar: "جديد", is_active: true, is_system: true, sort_order: 10, color: "#3B82F6" },
  { key: "running", label_en: "Running", label_ar: "يعمل", is_active: true, is_system: true, sort_order: 20, color: "#10B981" },
  {
    key: "absent_mosal",
    label_en: "Absent from MOSAL",
    label_ar: "غائب من وزارة الشؤون",
    is_active: true,
    is_system: true,
    sort_order: 30,
    color: "#F59E0B",
  },
  {
    key: "absent_moi",
    label_en: "Absent from MOI",
    label_ar: "غائب من وزارة الداخلية",
    is_active: true,
    is_system: true,
    sort_order: 40,
    color: "#F97316",
  },
  {
    key: "transfer_from_company",
    label_en: "Transfer from Company",
    label_ar: "نقل من الشركة",
    is_active: true,
    is_system: true,
    sort_order: 50,
    color: "#8B5CF6",
  },
  { key: "on_hold", label_en: "On Hold", label_ar: "موقوف", is_active: true, is_system: true, sort_order: 60, color: "#6B7280" },
  { key: "training", label_en: "Training", label_ar: "تدريب", is_active: true, is_system: true, sort_order: 70, color: "#06B6D4" },
  { key: "extension", label_en: "Extension", label_ar: "تمديد", is_active: true, is_system: true, sort_order: 80, color: "#0EA5E9" },
  { key: "accident", label_en: "Accident", label_ar: "حادث", is_active: true, is_system: true, sort_order: 90, color: "#EF4444" },
  { key: "cancelled", label_en: "Cancelled", label_ar: "ملغي", is_active: true, is_system: true, sort_order: 100, color: "#94A3B8" },
  { key: "leave", label_en: "Leave", label_ar: "إجازة", is_active: true, is_system: true, sort_order: 110, color: "#60A5FA" },
  { key: "leave_return", label_en: "Leave Return", label_ar: "عودة من الإجازة", is_active: true, is_system: true, sort_order: 120, color: "#22C55E" },
];

export const DEFAULT_EMPLOYEE_SECTIONS: readonly EmployeeCatalogRow[] = [
  {
    key: "service_field_mg_head_office",
    label_en: "Service Field - MG Head Office",
    label_ar: "خدمة ميدانية - المكتب الرئيسي",
    is_active: true,
    is_system: true,
    sort_order: 10,
    is_operational: false,
  },
];

/**
 * The nationality catalog HR files a rider under. Seeded so the Profile's
 * Nationality picker is usable on day one; an operator edit to any row
 * wins, and a stored list keeps its own order.
 */
export const DEFAULT_NATIONALITY_CATEGORIES: readonly EmployeeCatalogRow[] = [
  { key: "bangladeshi", label_en: "Bangladeshi", label_ar: "بنغلاديشي", is_active: true, is_system: true, sort_order: 10 },
  { key: "benin", label_en: "Benin", label_ar: "بنيني", is_active: true, is_system: true, sort_order: 20 },
  { key: "burkina_faso", label_en: "Burkina Faso", label_ar: "بوركيني", is_active: true, is_system: true, sort_order: 30 },
  { key: "chad", label_en: "Chad", label_ar: "تشادي", is_active: true, is_system: true, sort_order: 40 },
  { key: "egyptian", label_en: "Egyptian", label_ar: "مصري", is_active: true, is_system: true, sort_order: 50 },
  { key: "ethiopia", label_en: "Ethiopia", label_ar: "إثيوبي", is_active: true, is_system: true, sort_order: 60 },
  { key: "filipino", label_en: "Filipino", label_ar: "فلبيني", is_active: true, is_system: true, sort_order: 70 },
  { key: "ghana", label_en: "Ghana", label_ar: "غاني", is_active: true, is_system: true, sort_order: 80 },
  { key: "indian", label_en: "Indian", label_ar: "هندي", is_active: true, is_system: true, sort_order: 90 },
  { key: "kenya", label_en: "Kenya", label_ar: "كيني", is_active: true, is_system: true, sort_order: 100 },
  { key: "mali", label_en: "Mali", label_ar: "مالي", is_active: true, is_system: true, sort_order: 110 },
  { key: "nepalese", label_en: "Nepalese", label_ar: "نيبالي", is_active: true, is_system: true, sort_order: 120 },
  { key: "nigeria", label_en: "Nigeria", label_ar: "نيجيري", is_active: true, is_system: true, sort_order: 130 },
  { key: "pakistani", label_en: "Pakistani", label_ar: "باكستاني", is_active: true, is_system: true, sort_order: 140 },
  { key: "sierra_leone", label_en: "Sierra Leone", label_ar: "سيراليوني", is_active: true, is_system: true, sort_order: 150 },
  { key: "sri_lankan", label_en: "Sri Lankan", label_ar: "سريلانكي", is_active: true, is_system: true, sort_order: 160 },
  { key: "sudan", label_en: "Sudan", label_ar: "سوداني", is_active: true, is_system: true, sort_order: 170 },
  { key: "syrian", label_en: "Syrian", label_ar: "سوري", is_active: true, is_system: true, sort_order: 180 },
  { key: "togo", label_en: "Togo", label_ar: "توغولي", is_active: true, is_system: true, sort_order: 190 },
  { key: "ugandan", label_en: "Ugandan", label_ar: "أوغندي", is_active: true, is_system: true, sort_order: 200 },
];

/**
 * Who sponsors the rider's residency. A global catalog rather than a fixed
 * enum so HR can add a new sponsor company without a deploy.
 */
export const DEFAULT_SPONSORSHIPS: readonly EmployeeCatalogRow[] = [
  { key: "in_house", label_en: "In-house", label_ar: "داخلي", is_active: true, is_system: true, sort_order: 10 },
  { key: "partner", label_en: "Partner", label_ar: "شريك", is_active: true, is_system: true, sort_order: 20 },
  { key: "outsourced", label_en: "Outsourced", label_ar: "مُسنَد لجهة خارجية", is_active: true, is_system: true, sort_order: 30 },
  { key: "government", label_en: "Government", label_ar: "حكومي", is_active: true, is_system: true, sort_order: 40 },
];

export const DEFAULT_BANK_CODES: readonly EmployeeCatalogRow[] = [
  { key: "nbk", label_en: "National Bank of Kuwait", label_ar: "بنك الكويت الوطني", is_active: true, is_system: true, sort_order: 10, is_nbk: true },
  { key: "kfh", label_en: "Kuwait Finance House", label_ar: "بيت التمويل الكويتي", is_active: true, is_system: true, sort_order: 20 },
  { key: "gulf", label_en: "Gulf Bank", label_ar: "بنك الخليج", is_active: true, is_system: true, sort_order: 30 },
  { key: "burgan", label_en: "Burgan Bank", label_ar: "بنك برقان", is_active: true, is_system: true, sort_order: 40 },
  { key: "boubyan", label_en: "Boubyan Bank", label_ar: "بنك بوبيان", is_active: true, is_system: true, sort_order: 50 },
  { key: "cbk", label_en: "Commercial Bank of Kuwait", label_ar: "البنك التجاري الكويتي", is_active: true, is_system: true, sort_order: 60 },
  { key: "abk", label_en: "Al Ahli Bank of Kuwait", label_ar: "البنك الأهلي الكويتي", is_active: true, is_system: true, sort_order: 70 },
  { key: "kib", label_en: "Kuwait International Bank", label_ar: "بنك الكويت الدولي", is_active: true, is_system: true, sort_order: 80 },
  { key: "warba", label_en: "Warba Bank", label_ar: "بنك وربة", is_active: true, is_system: true, sort_order: 90 },
  { key: "aub", label_en: "Ahli United Bank", label_ar: "البنك الأهلي المتحد", is_active: true, is_system: true, sort_order: 100 },
];

export const DEFAULT_EMPLOYEE_STATUS_KEY = "new";
export const RUNNING_EMPLOYEE_STATUS_KEY = "running";

export function catalogKeyFromLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function catalogLabel(
  key: string | null | undefined,
  rows: readonly EmployeeCatalogRow[],
  locale: string,
): string {
  if (!key) return "—";
  const hit = rows.find((row) => row.key === key);
  if (!hit) return key;
  return locale.startsWith("ar") ? hit.label_ar || hit.label_en : hit.label_en;
}

export function mergeCatalogRows(
  stored: readonly EmployeeCatalogRow[],
  seeded: readonly EmployeeCatalogRow[],
): EmployeeCatalogRow[] {
  if (stored.length === 0) return seeded.map((row) => ({ ...row }));
  const seedByKey = new Map(seeded.map((row) => [row.key, row]));
  // A stored row that predates `is_operational` inherits the seed's answer, so a
  // system section cannot lose its non-operational flag by being edited once.
  const merged = stored.map((row) => {
    const seed = seedByKey.get(row.key);
    return seed && row.is_operational === undefined && seed.is_operational !== undefined
      ? { ...row, is_operational: seed.is_operational }
      : row;
  });
  const seen = new Set(merged.map((row) => row.key));
  const extras = seeded.filter((row) => row.is_system && !seen.has(row.key));
  return [...merged, ...extras].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

export function seedsForKind(kind: EmployeeCatalogKind): readonly EmployeeCatalogRow[] {
  switch (kind) {
    case "employee_statuses":
      return DEFAULT_EMPLOYEE_STATUSES;
    case "employee_sections":
      return DEFAULT_EMPLOYEE_SECTIONS;
    case "nationality_categories":
      return DEFAULT_NATIONALITY_CATEGORIES;
    case "bank_codes":
      return DEFAULT_BANK_CODES;
    case "sponsorships":
      return DEFAULT_SPONSORSHIPS;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function isNbkBank(key: string | null | undefined, banks: readonly EmployeeCatalogRow[]): boolean {
  if (!key) return false;
  const hit = banks.find((row) => row.key === key);
  return hit?.is_nbk === true || key === "nbk";
}

/**
 * Whether one section still needs a zone or a restaurant. A key the catalog
 * does not know is treated as operational: an unknown section must never be
 * able to remove the assignment gate.
 */
export function isOperationalSection(
  key: string,
  sections: readonly { key: string; is_operational?: boolean }[],
): boolean {
  const hit = sections.find((row) => row.key === key);
  return hit ? hit.is_operational !== false : true;
}

/**
 * True only when the rider has at least one section and every one of them is
 * non-operational. No section means "not stated" — the gate stays, because a
 * rider with no HR section at all is a data gap, not an office worker.
 */
export function isNonOperationalOnly(
  sectionKeys: readonly string[],
  sections: readonly { key: string; is_operational?: boolean }[],
): boolean {
  if (sectionKeys.length === 0) return false;
  return sectionKeys.every((key) => !isOperationalSection(key, sections));
}

export function parseCatalogRow(raw: Record<string, unknown>): EmployeeCatalogRow | null {
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!CATALOG_KEY_RE.test(key)) return null;
  return {
    key,
    label_en: typeof raw.label_en === "string" ? raw.label_en : key,
    label_ar: typeof raw.label_ar === "string" ? raw.label_ar : "",
    is_active: raw.is_active !== false,
    is_system: raw.is_system === true,
    sort_order: typeof raw.sort_order === "number" ? raw.sort_order : 100,
    color: typeof raw.color === "string" ? raw.color : null,
    is_nbk: raw.is_nbk === true,
    // Left absent when the field is absent, so a merged seed can fill it and an
    // older row keeps reading as operational.
    ...(typeof raw.is_operational === "boolean" ? { is_operational: raw.is_operational } : {}),
  };
}
