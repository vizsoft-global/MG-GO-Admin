import { DRIVER_IMPORT_EXPIRY_FIELDS } from "../types";

/** One current employee, already resolved to the words the importer accepts. */
export type ImportRosterSource = {
  intake: Record<string, unknown>;
  driver: Record<string, unknown> | null;
  profileName: string;
  profilePhone: string;
  zoneName: string;
  restaurantNames: readonly string[];
  vehicleLabel: string;
  partnerName: string;
  companyName: string;
  statusLabel: string;
  sectionLabels: readonly string[];
  nationalityLabels: readonly string[];
  sponsorshipLabel: string;
  bankLabel: string;
  assetNames: readonly string[];
  /** YYYY-MM-DD for a tracked document. A missing key stays a blank cell. */
  expiry: Partial<Record<(typeof DRIVER_IMPORT_EXPIRY_FIELDS)[number], string>>;
  /** Null when this month has no stored OFF row, so a re-upload does not write the default. */
  offDays: number | null;
  /** True only when the live account is already active. */
  accountActive: boolean;
  includeBank: boolean;
};

export function rosterText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "";
}

/** Date-only cells. A calendar string is kept; a timestamp is the Kuwait day. */
export function rosterYmd(value: unknown): string {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? "";
  }
  const date = rosterDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function rosterDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (!value || typeof value !== "object") return null;
  const stamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof stamp.toDate === "function") {
    const date = stamp.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const seconds = stamp.seconds ?? stamp._seconds;
  if (typeof seconds === "number") {
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function rosterMoney(value: unknown): string {
  if (value == null || value === "") return "";
  const amount = typeof value === "number" ? value : Number(rosterText(value));
  if (!Number.isFinite(amount) || amount < 0) return "";
  return amount.toFixed(3);
}

function rosterYesNo(value: unknown): string {
  if (value === true || value === "true" || value === "yes") return "yes";
  if (value === false || value === "false" || value === "no") return "no";
  return "";
}

function pick(source: ImportRosterSource, key: string): unknown {
  const driver = source.driver;
  if (driver && Object.prototype.hasOwnProperty.call(driver, key)) return driver[key];
  return source.intake[key];
}

function bag(source: ImportRosterSource, key: string): Record<string, unknown> {
  const live = source.driver?.[key];
  const stored = source.intake[key];
  const chosen =
    live && typeof live === "object" && !Array.isArray(live) ? live : stored;
  return chosen && typeof chosen === "object" && !Array.isArray(chosen)
    ? (chosen as Record<string, unknown>)
    : {};
}

function customCells(source: ImportRosterSource): Record<string, string> {
  const live = source.driver?.custom_fields;
  const stored = source.intake.custom_fields;
  const chosen =
    live && typeof live === "object" && !Array.isArray(live) ? live : stored;
  if (!chosen || typeof chosen !== "object" || Array.isArray(chosen)) return {};
  const cells: Record<string, string> = {};
  for (const [key, value] of Object.entries(chosen as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const joined = value.map((item) => rosterText(item)).filter(Boolean).join(", ");
      if (joined) cells[`cf:${key}`] = joined;
      continue;
    }
    const text = rosterText(value);
    if (text) cells[`cf:${key}`] = text;
  }
  return cells;
}

/** Cells keyed by the import field id. Blank means "leave the stored value". */
export function rosterCells(source: ImportRosterSource): Record<string, string> {
  const bank = source.includeBank ? bag(source, "bank_details") : {};
  const vehicleType = source.driver
    ? rosterText(pick(source, "vehicle_type_key")) || rosterText(pick(source, "vehicle_type"))
    : rosterText(source.intake.vehicle_type_key) || rosterText(source.intake.vehicle_type);
  const cells: Record<string, string> = {
    full_name: source.profileName || rosterText(pick(source, "full_name")),
    phone: source.profilePhone || rosterText(pick(source, "phone")),
    civil_id: rosterText(pick(source, "civil_id")),
    employee_id: rosterText(pick(source, "employee_id")),
    passport_number: rosterText(pick(source, "passport_number")),
    restaurant_ids: source.restaurantNames.join(", "),
    partner_id: source.partnerName,
    zone_id: source.zoneName,
    vehicle_label: source.vehicleLabel,
    vehicle_type: vehicleType,
    nationality: rosterText(pick(source, "nationality")),
    rider_category: rosterText(pick(source, "rider_category")),
    source_company: source.companyName,
    client_id: rosterText(pick(source, "client_id")),
    client_name: rosterText(pick(source, "client_name")),
    active: source.accountActive ? "yes" : "no",
    off_days: source.offDays == null ? "" : String(source.offDays),
    employee_status_key: source.statusLabel,
    section_keys: source.sectionLabels.join(", "),
    nationality_category_keys: source.nationalityLabels.join(", "),
    project_key: rosterText(pick(source, "project_key")),
    accommodation: rosterText(pick(source, "accommodation")),
    work_start_date: rosterYmd(pick(source, "work_start_date")),
    screenshots_allowed: rosterYesNo(pick(source, "screenshots_allowed")),
    login_verification_exempt: rosterYesNo(pick(source, "login_verification_exempt")),
    bank_code: source.includeBank ? source.bankLabel : "",
    account_number: source.includeBank ? rosterText(bank.account_number) : "",
    iban: source.includeBank ? rosterText(bank.iban) : "",
    beneficiary_civil_id: source.includeBank ? rosterText(bank.beneficiary_civil_id) : "",
    sponsorship_key: source.sponsorshipLabel,
    job_position: rosterText(pick(source, "job_position")),
    hiring_type: rosterText(pick(source, "hiring_type")),
    job_end_date: rosterYmd(pick(source, "job_end_date")),
    job_end_description: rosterText(pick(source, "job_end_description")),
    residency_expiry_date: rosterYmd(pick(source, "residency_expiry_date")),
    fixed_salary: rosterMoney(pick(source, "fixed_salary")),
    work_permit_salary: rosterMoney(pick(source, "work_permit_salary")),
    last_increment_date: rosterYmd(pick(source, "last_increment_date")),
    currency: rosterText(pick(source, "currency")),
    asset_ids: source.assetNames.join(", "),
  };
  for (const field of DRIVER_IMPORT_EXPIRY_FIELDS) {
    cells[field] = source.expiry[field] ?? "";
  }
  return { ...cells, ...customCells(source) };
}

export function importRosterDriversAoa(
  columns: readonly { field: string; header: string }[],
  rows: readonly Record<string, string>[],
): string[][] {
  return [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => row[column.field] ?? "")),
  ];
}
