import {
  MAX_ACCIDENT_ATTACHMENTS,
  REPLACEMENT_CASE_STATUSES,
  isAccidentCaseStatus,
  isAccidentSource,
  isDriverFault,
  isInsuranceClaimStatus,
  isPoliceReportStatus,
  isVehicleCaseStatus,
  type AccidentAttachmentMeta,
  type AccidentCaseStatus,
  type AccidentFilters,
  type AccidentInput,
  type AccidentRow,
  type AccidentSource,
} from "./accident-types";

/**
 * Pure model for an accident case: parse a stored row, validate an input, filter,
 * group, count. Nothing here imports Firestore, `next/*` or a React component, so
 * every rule below is testable with `node --test` and the backfill script can
 * reuse it without a server.
 */

const DEFAULT_SEVERITY_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function numeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Firestore Timestamp / Date / ISO string → ISO string. */
function instant(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") {
      const date = toDate.call(value) as Date;
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
    }
  }
  return "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function attachmentMetaList(value: unknown): AccidentAttachmentMeta[] {
  if (!Array.isArray(value)) return [];
  const out: AccidentAttachmentMeta[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const key = text(row.key);
    if (!key) continue;
    out.push({
      key,
      file_name: text(row.file_name),
      kind: text(row.kind),
      content_type: text(row.content_type),
      size: numeric(row.size),
      uploaded_by: text(row.uploaded_by),
      at: text(row.at),
    });
  }
  return out;
}

/**
 * A stored document → the display object. A row written before this module has no
 * `reference`, `case_status` or `source`; it maps to `null` here and is printed as
 * `Pending` **for display only** — the stored document is never rewritten.
 */
export function parseAccidentRow(id: string, data: Record<string, unknown> | undefined): AccidentRow {
  const row = data ?? {};
  const caseStatus = isAccidentCaseStatus(row.case_status) ? row.case_status : null;
  const vehicleCase = isVehicleCaseStatus(row.vehicle_case_status)
    ? row.vehicle_case_status
    : null;
  return {
    id,
    reference: text(row.reference),
    vehicle_id: text(row.vehicle_id) ?? "",
    plate_snapshot: text(row.plate_snapshot) ?? text(row.plate),
    vehicle_company_name: text(row.vehicle_company_name),
    model_year: numeric(row.model_year),
    driver_id: text(row.driver_id),
    driver_name: text(row.driver_name),
    driver_code: text(row.driver_code),
    employee_id: text(row.employee_id),
    occurred_at: instant(row.occurred_at),
    location_text: text(row.location_text),
    location_lat: numeric(row.location_lat),
    location_lng: numeric(row.location_lng),
    insurance_company: text(row.insurance_company),
    insurance_claim_status: isInsuranceClaimStatus(row.insurance_claim_status)
      ? row.insurance_claim_status
      : null,
    police_report_status: isPoliceReportStatus(row.police_report_status)
      ? row.police_report_status
      : null,
    amount_kwd: numeric(row.amount_kwd),
    driver_fault: isDriverFault(row.driver_fault) ? row.driver_fault : null,
    case_status: caseStatus,
    vehicle_case_status: vehicleCase,
    fleet_comment: text(row.fleet_comment),
    replacement_plate: text(row.replacement_plate),
    other_party_name: text(row.other_party_name),
    other_party_plate: text(row.other_party_plate),
    other_party_phone: text(row.other_party_phone),
    description: text(row.description),
    attachments: attachmentMetaList(row.attachment_meta),
    attachment_keys: stringList(row.attachment_keys),
    source: isAccidentSource(row.source) ? row.source : "admin",
    reported_by: text(row.reported_by),
    reported_by_name: text(row.reported_by_name),
    reviewed_at: text(row.reviewed_at),
    reviewed_by: text(row.reviewed_by),
    reviewed_by_name: text(row.reviewed_by_name),
    review_note: text(row.review_note),
    severity: text(row.severity),
    notes: text(row.notes),
    storage_key: text(row.storage_key),
    created_by: text(row.created_by),
    created_at: instant(row.created_at) || null,
    updated_at: instant(row.updated_at) || null,
  };
}

/** The case a row groups under. A legacy row displays as `Pending`. */
export function accidentCaseStatusOf(row: Pick<AccidentRow, "case_status">): AccidentCaseStatus {
  return row.case_status ?? "pending";
}

/** A rider report nobody has looked at yet — the KPI the client asked for. */
export function isRiderReportAwaitingCompletion(
  row: Pick<AccidentRow, "source" | "reviewed_at">,
): boolean {
  return row.source === "rider" && !row.reviewed_at;
}

/** The legacy severity column, still printed on a row that carries one. */
export function legacySeverityLabel(
  severity: string | null | undefined,
  labels: { low: string; medium: string; high: string } = DEFAULT_SEVERITY_LABELS,
): string {
  switch ((severity ?? "").trim().toLowerCase()) {
    case "low":
      return labels.low;
    case "medium":
      return labels.medium;
    case "high":
      return labels.high;
    default:
      return "—";
  }
}

/** The description the operator wrote, or the legacy `notes` when there is none. */
export function accidentDescriptionOf(
  row: Pick<AccidentRow, "description" | "notes">,
): string | null {
  return row.description ?? row.notes;
}

/**
 * Every object key the row references, including the single legacy `storage_key`
 * a pre-migration row holds. Display only — nothing is rewritten.
 */
export function accidentAttachmentKeys(
  row: Pick<AccidentRow, "attachment_keys" | "storage_key">,
): string[] {
  const keys = [...row.attachment_keys];
  if (row.storage_key && !keys.includes(row.storage_key)) keys.push(row.storage_key);
  return keys;
}

export function accidentAttachmentCount(
  row: Pick<AccidentRow, "attachment_keys" | "storage_key">,
): number {
  return accidentAttachmentKeys(row).length;
}

/** `YYYY-MM-DD` of the instant — the same day the list filter compares. */
export function accidentDayOf(row: Pick<AccidentRow, "occurred_at">): string {
  return row.occurred_at.slice(0, 10);
}

/** Newest first; an un-dated legacy row sorts last. */
export function sortAccidents(rows: AccidentRow[]): AccidentRow[] {
  return [...rows].sort(
    (a, b) =>
      b.occurred_at.localeCompare(a.occurred_at) ||
      (b.reference ?? "").localeCompare(a.reference ?? "") ||
      b.id.localeCompare(a.id),
  );
}

/** Search across the columns the toolbar's search box is expected to match. */
export function accidentMatchesSearch(
  row: AccidentRow,
  term: string,
  vehicleLabel?: string | null,
): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.reference,
    row.plate_snapshot,
    vehicleLabel,
    row.driver_name,
    row.driver_code,
    row.employee_id,
    row.location_text,
    row.insurance_company,
    row.insurance_claim_status,
    row.police_report_status,
    row.other_party_name,
    row.other_party_plate,
    row.other_party_phone,
    accidentDescriptionOf(row),
    row.fleet_comment,
    row.replacement_plate,
    row.severity,
    accidentDayOf(row),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** Every filter is "any" when blank, so an untouched row of controls shows all. */
export function filterAccidents(rows: AccidentRow[], filters: AccidentFilters): AccidentRow[] {
  return rows.filter((row) => {
    if (filters.caseStatus && accidentCaseStatusOf(row) !== filters.caseStatus) return false;
    if (filters.source && row.source !== filters.source) return false;
    if (filters.vehicleId && row.vehicle_id !== filters.vehicleId) return false;
    if (filters.driverId && (row.driver_id ?? "") !== filters.driverId) return false;
    if (filters.insuranceClaimStatus && (row.insurance_claim_status ?? "") !== filters.insuranceClaimStatus) {
      return false;
    }
    if (filters.policeReportStatus && (row.police_report_status ?? "") !== filters.policeReportStatus) {
      return false;
    }
    const day = accidentDayOf(row);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });
}

export type AccidentCaseGroup = {
  status: AccidentCaseStatus;
  rows: AccidentRow[];
};

/** Group by case, in the PDF's own order: Pending, Delay, Close. */
export function groupAccidentsByCase(rows: AccidentRow[]): AccidentCaseGroup[] {
  const order: AccidentCaseStatus[] = ["pending", "delay", "close"];
  return order
    .map((status) => ({
      status,
      rows: rows.filter((row) => accidentCaseStatusOf(row) === status),
    }))
    .filter((group) => group.rows.length > 0);
}

export type AccidentKpis = {
  total: number;
  /** Pending + Delay — every case that is not closed. */
  open: number;
  pending: number;
  delay: number;
  close: number;
  riderAwaiting: number;
};

export function computeAccidentKpis(rows: AccidentRow[]): AccidentKpis {
  const kpis: AccidentKpis = {
    total: rows.length,
    open: 0,
    pending: 0,
    delay: 0,
    close: 0,
    riderAwaiting: 0,
  };
  for (const row of rows) {
    kpis[accidentCaseStatusOf(row)] += 1;
    if (isRiderReportAwaitingCompletion(row)) kpis.riderAwaiting += 1;
  }
  kpis.open = kpis.pending + kpis.delay;
  return kpis;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Digits of a phone number, ignoring spaces, dashes, brackets and a leading `+`. */
export function phoneDigits(value: string): string {
  return value.replace(/[^\d]/g, "");
}

const FUTURE_TOLERANCE_MS = 60_000;

/**
 * The form gate.
 *
 * The only time rule is "not in the future" — the same refusal `createVehicleAccident`
 * has always made. There is **no lower bound**: a rider may file a historical
 * accident, and the old seven-day window was removed on the client's instruction.
 */
export function validateAccidentInput(input: AccidentInput, now: Date = new Date()): ValidationResult {
  if (!input.vehicleId.trim()) return { ok: false, error: "missing_vehicle" };

  const occurred = new Date(input.occurredAt);
  if (Number.isNaN(occurred.getTime())) return { ok: false, error: "invalid_date" };
  if (occurred.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, error: "future_date" };
  }

  if (!input.locationText.trim()) return { ok: false, error: "location_required" };

  if (input.driverFault.trim() && !isDriverFault(input.driverFault)) {
    return { ok: false, error: "invalid_driver_fault" };
  }
  if (input.caseStatus.trim() && !isAccidentCaseStatus(input.caseStatus)) {
    return { ok: false, error: "invalid_case_status" };
  }
  if (input.vehicleCaseStatus.trim() && !isVehicleCaseStatus(input.vehicleCaseStatus)) {
    return { ok: false, error: "invalid_vehicle_case_status" };
  }
  if (input.insuranceClaimStatus.trim() && !isInsuranceClaimStatus(input.insuranceClaimStatus)) {
    return { ok: false, error: "invalid_insurance_status" };
  }
  if (input.policeReportStatus.trim() && !isPoliceReportStatus(input.policeReportStatus)) {
    return { ok: false, error: "invalid_police_status" };
  }

  if (input.amountKwd != null && (!Number.isFinite(input.amountKwd) || input.amountKwd < 0)) {
    return { ok: false, error: "invalid_amount" };
  }
  if (input.otherPartyPhone.trim()) {
    const digits = phoneDigits(input.otherPartyPhone);
    if (digits.length < 7 || digits.length > 15) return { ok: false, error: "invalid_phone" };
  }
  if (
    isVehicleCaseStatus(input.vehicleCaseStatus) &&
    REPLACEMENT_CASE_STATUSES.includes(input.vehicleCaseStatus) &&
    !input.replacementPlate.trim()
  ) {
    return { ok: false, error: "replacement_plate_required" };
  }
  for (const [value, minimum, maximum] of [
    [input.locationLat, -90, 90],
    [input.locationLng, -180, 180],
  ] as const) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      return { ok: false, error: "invalid_location" };
    }
  }
  if (input.attachmentKeys.length > MAX_ACCIDENT_ATTACHMENTS) {
    return { ok: false, error: "too_many_attachments" };
  }
  return { ok: true };
}


/* ------------------------------------------------------------ one writer ---
 * There is exactly one function that turns an input into the stored document.
 * It is pure, so it can be unit-tested and so both entry points — the new
 * `createAccident` action and the legacy `createVehicleAccident` delegation the
 * vehicle-detail dialog used to own — provably write the same shape. It cannot
 * live in `accident-actions.ts`: that module is `"use server"`, and such a module
 * may only export async functions.
 */

export type AccidentVehicleSnapshot = {
  plate: string | null;
  company_name: string | null;
  model_year: number | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_code: string | null;
  employee_id: string | null;
};

export type AccidentWriteOptions = {
  reference: string;
  attachments: AccidentAttachmentMeta[];
  source: AccidentSource;
  reportedBy: string | null;
  reportedByName: string | null;
  caseStatus: AccidentCaseStatus;
  vehicleCaseStatus: string | null;
  /** One clock for the whole document, so two callers agree to the millisecond. */
  now: Date;
};

function capped(value: string, limit: number): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function severityOrNull(value: string): string | null {
  const next = value.trim().toLowerCase();
  return next === "low" || next === "medium" || next === "high" ? next : null;
}

/**
 * The stored document. `updated_at` is written beside `created_at` here so a
 * create and an update of the same input cannot drift apart.
 */
export function accidentWritePayload(
  input: AccidentInput,
  snapshot: AccidentVehicleSnapshot,
  options: AccidentWriteOptions,
): Record<string, unknown> {
  const attachmentKeys = input.attachmentKeys
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, MAX_ACCIDENT_ATTACHMENTS);
  return {
    reference: options.reference,
    vehicle_id: input.vehicleId.trim(),
    plate_snapshot: snapshot.plate,
    vehicle_company_name: snapshot.company_name,
    model_year: snapshot.model_year,
    driver_id: snapshot.driver_id,
    driver_name: snapshot.driver_name,
    driver_code: snapshot.driver_code,
    employee_id: snapshot.employee_id,
    occurred_at: new Date(input.occurredAt),
    location_text: capped(input.locationText, 240),
    location_lat: input.locationLat,
    location_lng: input.locationLng,
    insurance_company: capped(input.insuranceCompany, 120),
    insurance_claim_status: isInsuranceClaimStatus(input.insuranceClaimStatus)
      ? input.insuranceClaimStatus
      : null,
    police_report_status: isPoliceReportStatus(input.policeReportStatus)
      ? input.policeReportStatus
      : null,
    amount_kwd: input.amountKwd == null ? null : Math.round(input.amountKwd * 1000) / 1000,
    // Yes / No only. A blank answer is stored as blank, never as a third word.
    driver_fault: isDriverFault(input.driverFault) ? input.driverFault : null,
    case_status: options.caseStatus,
    vehicle_case_status: isVehicleCaseStatus(options.vehicleCaseStatus ?? "")
      ? options.vehicleCaseStatus
      : null,
    fleet_comment: capped(input.fleetComment, 600),
    replacement_plate: capped(input.replacementPlate, 40),
    other_party_name: capped(input.otherPartyName, 120),
    other_party_plate: capped(input.otherPartyPlate, 40),
    other_party_phone: capped(input.otherPartyPhone, 40),
    description: capped(input.description, 1000),
    attachment_keys: attachmentKeys,
    attachment_meta: options.attachments.slice(0, MAX_ACCIDENT_ATTACHMENTS),
    source: options.source,
    reported_by: options.reportedBy,
    reported_by_name: options.reportedByName,
    reviewed_at: null,
    reviewed_by: null,
    reviewed_by_name: null,
    review_note: null,
    // Legacy columns: kept, written only when the operator filled them.
    severity: severityOrNull(input.severity),
    notes: capped(input.notes, 600),
    storage_key: null,
    created_at: options.now,
    updated_at: options.now,
  };
}

/**
 * The keys an edit is allowed to move. Identity, provenance and the reference are
 * fixed once the case exists — only the case work is editable.
 */
export const ACCIDENT_EDITABLE_FIELDS = [
  "occurred_at",
  "location_text",
  "location_lat",
  "location_lng",
  "insurance_company",
  "insurance_claim_status",
  "police_report_status",
  "amount_kwd",
  "driver_fault",
  "case_status",
  "vehicle_case_status",
  "fleet_comment",
  "replacement_plate",
  "other_party_name",
  "other_party_plate",
  "other_party_phone",
  "description",
  "attachment_keys",
  "attachment_meta",
  "severity",
  "notes",
  "reviewed_at",
  "reviewed_by",
  "reviewed_by_name",
  "review_note",
  "updated_at",
] as const;

/** The subset of `accidentWritePayload` an update may write. */
export function editableAccidentFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ACCIDENT_EDITABLE_FIELDS) {
    if (field in payload) out[field] = payload[field];
  }
  return out;
}

