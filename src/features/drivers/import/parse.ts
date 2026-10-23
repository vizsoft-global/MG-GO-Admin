import {
  cleanCell,
  loadStoredMapping as loadStoredMappingBase,
  saveStoredMapping as saveStoredMappingBase,
} from "@/lib/import/spreadsheet";
import { normalizeCivilId, normalizeKuwaitPhone } from "../driver-phone";
import { normalizeEmployeeId } from "../driver-errors";
import type { DriverImportMappedRow, DriverImportTargetField, DriverRiderCategory } from "../types";
import { customFieldColumnId } from "@/lib/custom-fields/types";

/**
 * A cell holding exactly this token clears the field. A blank cell leaves it
 * untouched, so a partial sheet can never null a column it does not mention.
 */
export const CLEAR_TOKEN = "-";

export function isClearToken(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim() === CLEAR_TOKEN;
}

export function parseRiderCategory(
  raw: string | null | undefined,
): DriverRiderCategory | "invalid" | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_house" || key === "inhouse") return "in_house";
  if (key === "outsourced" || key === "outsource") return "outsourced";
  return "invalid";
}

/**
 * Reads the sheet's Active cell.
 *
 * `null` (blank) is not the same as `false`: blank means the sheet expressed no
 * opinion and the dialog's approve toggle decides, which is what keeps an
 * uploaded file that predates this column behaving exactly as it used to.
 * Anything unrecognised is `"invalid"` rather than a silent `false`, since
 * quietly not approving a batch someone marked for approval is the failure
 * this column exists to avoid.
 */
export function parseImportActive(
  raw: string | null | undefined,
): boolean | "invalid" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["yes", "y", "true", "1", "active", "approved"].includes(value)) return true;
  if (["no", "n", "false", "0", "inactive", "pending"].includes(value)) return false;
  return "invalid";
}

/**
 * Reads the sheet's Vehicle Type cell. The catalogue is locked to two keys
 * because a map sprite is drawn from it, so anything that is not clearly a car
 * is a bike — rule 12's unknown-vehicle default. `null` means the cell was
 * blank, and the matched vehicle's own type (or bike) decides.
 */
export function parseImportVehicleType(
  raw: string | null | undefined,
): "bike" | "car" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  const key = value.replace(/[\s-]+/g, "_");
  if (
    [
      "car",
      "cars",
      "van",
      "truck",
      "lorry",
      "suv",
      "four_wheeler",
      "4_wheeler",
      "auto",
      "سيارة",
      "سياره",
      "مركبة",
      "مركبه",
      "شاحنة",
      "شاحنه",
    ].includes(key) ||
    value.includes("سيار") ||
    /(^|[^a-z])cars?([^a-z]|$)/.test(value)
  ) {
    return "car";
  }
  return "bike";
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function safeYmd(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Sheet date → `YYYY-MM-DD` on the Kuwait calendar, or `null` when the cell is
 * not a date. Accepts an Excel serial, `dd/mm/yyyy`, `yyyy-mm-dd` and ISO
 * datetimes, which is what Excel hands back depending on the column format.
 */
export function parseImportDate(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86_400_000);
    return safeYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (ymd) return safeYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dmy) return safeYmd(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

/** Yes/No toggle cells. Blank = no opinion, anything else unrecognised = invalid. */
export function parseImportYesNo(raw: string | null | undefined): boolean | "invalid" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["yes", "y", "true", "1", "on", "allow", "allowed"].includes(value)) return true;
  if (["no", "n", "false", "0", "off", "deny", "blocked", "not allowed"].includes(value)) {
    return false;
  }
  return "invalid";
}

/** `a, b; c` → `["a","b","c"]`, de-duplicated, order preserved. */
export function parseImportMultiKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;|]/)) {
    const token = part.trim();
    if (token && !out.some((item) => item.toLowerCase() === token.toLowerCase())) {
      out.push(token);
    }
  }
  return out;
}

export function normalizeImportIban(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  return compact || null;
}

/** ISO 13616 mod-97 check for a Kuwaiti IBAN. */
export function isValidImportIban(raw: string): boolean {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^KW[0-9A-Z]{28}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = char >= "0" && char <= "9" ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function normalizeImportAccountNumber(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").replace(/[\s-]+/g, "");
  return compact || null;
}

export function normalizeImportPassport(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return compact || null;
}

export function isValidImportPassport(raw: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(raw);
}

export function mapRowsFromSheet(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<DriverImportTargetField, string>>,
  customFieldKeys: string[] = [],
): DriverImportMappedRow[] {
  const headerIndex = new Map(headers.map((h, i) => [cleanCell(h), i]));

  /**
   * A field counts as present only when the mapping names a header that the
   * sheet actually has. Everything else is left untouched at write time.
   */
  const present: Partial<Record<DriverImportTargetField, boolean>> = {};
  for (const [field, header] of Object.entries(mapping) as Array<
    [DriverImportTargetField, string]
  >) {
    if (header && headerIndex.has(cleanCell(header))) present[field] = true;
  }

  return rows
    .map((row, rowIndex) => {
      const cleared: Partial<Record<DriverImportTargetField, boolean>> = {};
      const get = (field: DriverImportTargetField): string | null => {
        const src = mapping[field];
        if (!src) return null;
        const idx = headerIndex.get(cleanCell(src));
        if (idx == null) return null;
        const v = cleanCell(row[idx]);
        if (!v) return null;
        if (isClearToken(v)) {
          cleared[field] = true;
          return null;
        }
        return v;
      };

      const phoneRaw = get("phone");
      const civilRaw = get("civil_id");
      const empRaw = get("employee_id");
      const custom_fields: Record<string, string | null> = {};
      for (const key of customFieldKeys) {
        const cfKey = customFieldColumnId(key) as DriverImportTargetField;
        if (!mapping[cfKey]) continue;
        custom_fields[key] = get(cfKey);
      }

      return {
        rowIndex,
        full_name: get("full_name"),
        phone: phoneRaw ? (normalizeKuwaitPhone(phoneRaw) ?? phoneRaw) : null,
        civil_id: civilRaw ? (normalizeCivilId(civilRaw) ?? civilRaw) : null,
        employee_id: empRaw ? (normalizeEmployeeId(empRaw) ?? empRaw) : null,
        passport_number: get("passport_number"),
        partner_id: get("partner_id"),
        zone_id: get("zone_id"),
        vehicle_label: get("vehicle_label"),
        vehicle_type: get("vehicle_type"),
        restaurant_ids: get("restaurant_ids"),
        nationality: get("nationality"),
        rider_category: get("rider_category"),
        source_company: get("source_company"),
        client_id: get("client_id"),
        client_name: get("client_name"),
        active: get("active"),
        off_days: get("off_days"),
        employee_status_key: get("employee_status_key"),
        section_keys: get("section_keys"),
        nationality_category_keys: get("nationality_category_keys"),
        project_key: get("project_key"),
        accommodation: get("accommodation"),
        work_start_date: get("work_start_date"),
        screenshots_allowed: get("screenshots_allowed"),
        login_verification_exempt: get("login_verification_exempt"),
        bank_code: get("bank_code"),
        account_number: get("account_number"),
        iban: get("iban"),
        beneficiary_civil_id: get("beneficiary_civil_id"),
        license_expiry: get("license_expiry"),
        civil_id_expiry: get("civil_id_expiry"),
        work_permit_expiry: get("work_permit_expiry"),
        passport_expiry: get("passport_expiry"),
        health_card_expiry: get("health_card_expiry"),
        operations_card_expiry: get("operations_card_expiry"),
        sponsorship_key: get("sponsorship_key"),
        job_position: get("job_position"),
        hiring_type: get("hiring_type"),
        job_end_date: get("job_end_date"),
        job_end_description: get("job_end_description"),
        residency_expiry_date: get("residency_expiry_date"),
        fixed_salary: get("fixed_salary"),
        work_permit_salary: get("work_permit_salary"),
        last_increment_date: get("last_increment_date"),
        currency: get("currency"),
        asset_ids: get("asset_ids"),
        custom_fields,
        present,
        cleared,
      };
    })
    .filter(
      (r) =>
        r.full_name ||
        r.phone ||
        r.civil_id ||
        r.employee_id ||
        r.passport_number ||
        r.restaurant_ids ||
        r.partner_id ||
        r.zone_id ||
        r.nationality ||
        r.rider_category ||
        r.source_company ||
        r.client_id ||
        r.client_name ||
        r.employee_status_key ||
        r.bank_code ||
        r.iban ||
        Object.values(r.custom_fields).some(Boolean),
    );
}

export function guessColumnMapping(
  headers: string[],
  customFieldKeys: string[] = [],
): Partial<Record<DriverImportTargetField, string>> {
  const lower = headers.map((h) => ({ raw: h, key: cleanCell(h).toLowerCase() }));
  const find = (...needles: string[]) => {
    const hit = lower.find((h) => needles.some((n) => h.key.includes(n)));
    return hit?.raw;
  };
  const findExcept = (exclude: string[], ...needles: string[]) => {
    const hit = lower.find(
      (h) => needles.some((n) => h.key.includes(n)) && !exclude.some((x) => h.key.includes(x)),
    );
    return hit?.raw;
  };
  const OTHER_NAMES = ["company", "client", "platform", "partner", "restaurant", "zone"];
  const EXPIRY_WORDS = [
    "expiry",
    "expire",
    "expires",
    "expiration",
    "valid until",
    "end date",
    "انتهاء",
    "انتهاء الصلاحية",
  ];
  const isExpiryHeader = (key: string) => EXPIRY_WORDS.some((word) => key.includes(word));
  /** Identity columns must never swallow their own expiry column. */
  const findNoExpiry = (...needles: string[]) => {
    const hit = lower.find(
      (h) => !isExpiryHeader(h.key) && needles.some((n) => h.key.includes(n)),
    );
    return hit?.raw;
  };

  const mapping: Partial<Record<DriverImportTargetField, string>> = {
    full_name:
      find("full name", "driver name") ?? findExcept(OTHER_NAMES, "name"),
    phone: find("phone", "mobile", "tel"),
    civil_id: findNoExpiry("civil", "national id", "nid"),
    employee_id: find(
      "mg id",
      "mg_id",
      "mgid",
      "employee id",
      "employeeid",
      "emp id",
      "emp_id",
      "employee",
    ),
    passport_number: findNoExpiry("passport", "passport number", "passport no"),
    partner_id: find("partner id", "partner_id", "partner uuid", "partner"),
    zone_id: find("zone id", "zone_id", "zone uuid", "zone"),
    // "Vehicle Type" is its own column, so the plate lookup must not swallow it.
    vehicle_label: findExcept(["type", "kind"], "vehicle", "bike", "plate"),
    vehicle_type: find(
      "vehicle type",
      "vehicle_type",
      "vehicle kind",
      "vehicle_kind",
      "bike type",
      "car type",
      "type of vehicle",
    ),
    restaurant_ids: find(
      "restaurant id",
      "restaurant_ids",
      "restaurant code",
      "restaurants",
      "restaurant",
      "rst-",
      "store id",
      "merchant id",
    ),
    nationality: find("country"),
    rider_category: find("rider category", "category", "outsourced", "in house"),
    // A company's Client ID is derived, so a "Company Client ID" column is never
    // the company itself.
    source_company: findExcept(
      ["client id", "client_id", "code"],
      "company name",
      "company_name",
      "source company",
      "source_company",
      "company",
    ),
    // Deliberately not a bare "client" needle: `find` returns the first header
    // matching any needle, so "client" would let a sheet carrying only Client ID
    // fill Client name with the same column. "company" is excluded because the
    // company's Client ID is not the platform's.
    client_id: findExcept(["company"], "platform id", "platform_id", "client id", "client_id", "client code"),
    client_name: findExcept(
      ["company", " id", "_id"],
      "platform name",
      "platform_name",
      "client name",
      "client_name",
      "platform",
    ),
    // Not "status": the intake already has a workflow status column elsewhere,
    // and guessing that one onto this field would approve drivers nobody asked
    // to approve.
    active: find("active", "approve"),
    off_days: find("number of offs", "number of off", "off days", "off_days"),
    employee_status_key: find("employee status", "employee_status", "hr status", "hr_status"),
    section_keys: find("employee section", "section", "sections"),
    nationality_category_keys:
      find("nationality category", "nationality_category", "nationality group") ??
      findExcept(["country"], "nationality"),
    project_key: find("project", "project key", "project_key"),
    accommodation: find("accommodation", "housing"),
    work_start_date: find(
      "work start",
      "work_start",
      "joined",
      "join date",
      "joining date",
      "date of joining",
      "hire date",
    ),
    sponsorship_key: find("sponsorship", "sponsor"),
    job_position: find("job position", "job_position"),
    hiring_type: find("hiring type", "hiring_type", "hiring"),
    job_end_date: findExcept(
      ["description", "reason"],
      "job end date",
      "job_end_date",
      "end of job",
    ),
    job_end_description: find(
      "job end description",
      "job_end_description",
      "end description",
      "leaving reason",
    ),
    residency_expiry_date: find("residency expiry", "residency_expiry", "residency"),
    fixed_salary: find("fixed salary", "fixed_salary"),
    work_permit_salary: find("work permit salary", "work_permit_salary", "permit salary"),
    last_increment_date: find("last increment", "increment date", "last_increment"),
    currency: find("currency", "payment currency"),
    asset_ids: findExcept(["request"], "assets", "asset"),
    screenshots_allowed: find("screenshots", "screenshot"),
    login_verification_exempt: find("login verification", "verification exempt", "exempt"),
    bank_code: find("bank code", "bank_code", "bank name", "bank"),
    account_number: find("account number", "account no", "account_number"),
    iban: find("iban"),
    beneficiary_civil_id: find("beneficiary"),
    license_expiry: find(
      "license expiry",
      "license_expiry",
      "license expires",
      "licence expiry",
      "driving license expiry",
      "رخصة",
    ),
    civil_id_expiry: find("civil id expiry", "civil_id_expiry", "civil expires", "civil expiry"),
    work_permit_expiry: find(
      "work permit expiry",
      "work_permit_expiry",
      "work permit expires",
      "permit expiry",
    ),
    passport_expiry: find("passport expiry", "passport_expiry", "passport expires"),
    health_card_expiry: find("health card expiry", "health_card_expiry", "health card expires"),
    operations_card_expiry: find(
      "operations card expiry",
      "operations_card_expiry",
      "operation card expiry",
      "operations card expires",
    ),
  };

  for (const key of customFieldKeys) {
    const hit = find(key.replace(/_/g, " "), key);
    if (hit) mapping[customFieldColumnId(key) as DriverImportTargetField] = hit;
  }

  return mapping;
}

export const MAPPING_STORAGE_PREFIX = "dpd-driver-import-mapping:";

export function loadStoredMapping(
  signature: string,
): Partial<Record<DriverImportTargetField, string>> | null {
  return loadStoredMappingBase<DriverImportTargetField>(
    MAPPING_STORAGE_PREFIX,
    signature,
  );
}

export function saveStoredMapping(
  signature: string,
  mapping: Partial<Record<DriverImportTargetField, string>>,
) {
  saveStoredMappingBase(MAPPING_STORAGE_PREFIX, signature, mapping);
}
