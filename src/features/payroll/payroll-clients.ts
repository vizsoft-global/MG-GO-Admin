/**
 * The payroll client catalog.
 *
 * `payroll_clients/{key}` is the one source of truth for "which client does this
 * rider deliver for": the employee record stores `drivers.project_key`, the
 * payroll engine prices a client's rules, and Attendance & Orders draws one card
 * per active client. The three keys the SOP names (`americana`, `keeta`,
 * `five_guys`) are seeded as system rows and keep their own day shape; a client
 * added later gets the Americana-style profile.
 *
 * The key doubles as the document id, so it has the same shape as every other
 * catalog key in the panel.
 */
export const PAYROLL_CLIENT_KEY_RE = /^[a-z0-9_]{1,24}$/;

/**
 * The three clients the SOP names. They resolve even on an environment whose
 * `payroll_clients` document has not been seeded, because the compiled contract
 * (day shape, exports) already knows them.
 */
export const BUILTIN_PAYROLL_CLIENT_KEYS = ["americana", "keeta", "five_guys"] as const;

export function isBuiltinPayrollClientKey(value: string | null | undefined): boolean {
  return (BUILTIN_PAYROLL_CLIENT_KEYS as readonly string[]).includes(String(value ?? ""));
}

export type PayrollClientRow = {
  key: string;
  name: string;
  nameAr: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  usesZone: boolean;
  usesOrders: boolean;
  usesHours: boolean;
  fullDayHours: number;
  halfDayHours: number;
  reducedHours: number;
  requiredHoursPerDay: number;
  defaultOffDays: number;
  goodThreshold: number;
  averageThreshold: number;
  /** The rule kind a day with no matching rule falls back to (`12`, `3h`, …). */
  defaultResultKind?: string;
  /** How many riders currently carry this key — 0 hides the Delete action. */
  riderCount: number;
};

export type PayrollClientInput = {
  key?: string | null;
  name: string;
  nameAr?: string | null;
  isActive?: boolean;
  usesZone?: boolean;
  usesOrders?: boolean;
  usesHours?: boolean;
  fullDayHours?: number;
  halfDayHours?: number;
  reducedHours?: number;
  requiredHoursPerDay?: number;
  defaultOffDays?: number;
  goodThreshold?: number;
  averageThreshold?: number;
  defaultResultKind?: string;
  sortOrder?: number;
};

/** The rule kinds the payroll engine understands — the default-result picker. */
export const PAYROLL_RULE_KINDS = ["12", "3h", "HALF", "ACT", "ABS", "ALH", "ALO", "CUS"] as const;

export type PayrollRuleKind = (typeof PAYROLL_RULE_KINDS)[number];

export function isPayrollRuleKind(value: string | null | undefined): value is PayrollRuleKind {
  return (PAYROLL_RULE_KINDS as readonly string[]).includes(String(value ?? ""));
}

export const DEFAULT_PAYROLL_CLIENTS: readonly PayrollClientRow[] = [
  {
    key: "americana",
    name: "Americana",
    nameAr: "أمريكانا",
    isActive: true,
    isSystem: true,
    sortOrder: 10,
    usesZone: true,
    usesOrders: true,
    usesHours: false,
    fullDayHours: 12,
    halfDayHours: 6,
    reducedHours: 3,
    requiredHoursPerDay: 12,
    defaultOffDays: 2,
    goodThreshold: 110,
    averageThreshold: 70,
    riderCount: 0,
  },
  {
    key: "keeta",
    name: "Keeta",
    nameAr: "كيتا",
    isActive: true,
    isSystem: true,
    sortOrder: 20,
    usesZone: false,
    usesOrders: false,
    usesHours: true,
    fullDayHours: 10,
    halfDayHours: 5,
    reducedHours: 3,
    requiredHoursPerDay: 10,
    defaultOffDays: 2,
    goodThreshold: 110,
    averageThreshold: 70,
    riderCount: 0,
  },
  {
    key: "five_guys",
    name: "Five Guys",
    nameAr: "فايف قايز",
    isActive: true,
    isSystem: true,
    sortOrder: 30,
    usesZone: true,
    usesOrders: false,
    usesHours: true,
    fullDayHours: 8,
    halfDayHours: 4,
    reducedHours: 2,
    requiredHoursPerDay: 8,
    defaultOffDays: 2,
    goodThreshold: 110,
    averageThreshold: 70,
    riderCount: 0,
  },
] as const;

/** A name → key slug, the same rule the other catalogs use. */
export function payrollClientKeyFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

/**
 * A stored `drivers.project_key` as the catalog key it denotes, or null.
 *
 * Accepts the spellings an operator and a spreadsheet already produce
 * (`Keeta`, `Five Guys`, `five-guys`) so an import cannot lose a client to a
 * space, but never invents a key that the catalog does not hold.
 */
export function normalizePayrollClientKey(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const slug = value.replace(/[\s-]+/g, "_");
  return PAYROLL_CLIENT_KEY_RE.test(slug) ? slug : null;
}

/** Signed true when the catalog holds this key, active or not. */
export function findPayrollClient(
  rows: readonly PayrollClientRow[],
  key: string | null | undefined,
): PayrollClientRow | null {
  const normalized = normalizePayrollClientKey(key);
  if (!normalized) return null;
  return rows.find((row) => row.key === normalized) ?? null;
}

/**
 * A spreadsheet's Project/Client cell → a catalog key.
 *
 * Accepts the key (`al_musallam`), the English or Arabic name, or the name as a
 * slug, so a sheet can name the client the way an operator says it. A value that
 * matches nothing is `unknown` — the preview refuses it rather than storing a
 * project no card and no rule set can price. An empty cell is `empty`: it is
 * "no opinion", which for an update keeps the stored client.
 */
export function resolvePayrollClientToken(
  raw: string | null | undefined,
  rows: readonly PayrollClientRow[],
): { status: "empty" } | { status: "ok"; key: string } | { status: "unknown" } {
  const value = String(raw ?? "").trim();
  if (!value) return { status: "empty" };
  const active = rows.filter((row) => row.isActive !== false);
  const byKey = normalizePayrollClientKey(value);
  // A key the catalog holds is valid even when the client is switched off: a
  // re-import of an existing rider must not fail on their current value.
  if (byKey && (isBuiltinPayrollClientKey(byKey) || rows.some((row) => row.key === byKey))) {
    return { status: "ok", key: byKey };
  }
  const needle = value.toLowerCase();
  const named = active.find(
    (row) =>
      row.name.trim().toLowerCase() === needle || row.nameAr.trim().toLowerCase() === needle,
  );
  if (named) return { status: "ok", key: named.key };
  const bySlug = active.find((row) => payrollClientKeyFromName(row.name) === payrollClientKeyFromName(value));
  if (bySlug) return { status: "ok", key: bySlug.key };
  return { status: "unknown" };
}

/** The label the operator reads, preferring the Arabic name in Arabic. */
export function payrollClientLabel(
  row: Pick<PayrollClientRow, "key" | "name" | "nameAr"> | null | undefined,
  locale: string,
): string {
  if (!row) return "";
  if (locale.startsWith("ar") && row.nameAr.trim()) return row.nameAr;
  return row.name.trim() || row.key;
}

/** `al_musallam` → `Al-Musallam`, so a file name survives an unknown key. */
export function payrollClientExportName(key: string, name?: string | null): string {
  const source = (name ?? "").trim() || key;
  const words = source
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) return "Client";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}
