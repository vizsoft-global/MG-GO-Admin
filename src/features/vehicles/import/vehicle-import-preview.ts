import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  isVehicleCarType,
  isVehicleCondition,
  isVehicleFuelCompany,
  isVehicleFuelType,
} from "@/features/fleet/fleet-labels";
import { isKuwaitPlate, plateToBikeId } from "../plate-id";
import { USE_TYPE_KEY_RE } from "../vehicle-use-types";
import { validateVehicleForm } from "../vehicle-form-validation";
import {
  headerToField,
  type VehicleImportField,
} from "./vehicle-import-columns";
import {
  cellIntent,
  dateCellIntent,
  expiryBeforeIssue,
  isCleared,
  lookupKey,
  normalizeEnumValue,
  patchedEnum,
  patchedText,
} from "./vehicle-import-patch";

export type VehicleSheetSnapshot = {
  bike_id: string;
  reg_number: string | null;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  vehicle_type_key: string;
  project_type: "group" | "rent";
  status: "active" | "suspended" | "maintenance";
  location_text: string | null;
  condition: string | null;
  car_type: string | null;
  type_of_use: string | null;
  fuel_type: string | null;
  fuel_company: string | null;
  chip_no: string | null;
  fuel_monthly_limit_kwd: number | null;
  /** `vehicle_companies.key`; the sheet accepts the key or either label. */
  company_id: string | null;
  /** `partners.id`; the sheet accepts the partner name. */
  owner_partner_id: string | null;
  registration_issued_at: string | null;
  registration_expires_at: string | null;
  insurance_issued_at: string | null;
  insurance_expires_at: string | null;
  replaces_vehicle_id: string | null;
  replacement_started_at: string | null;
};

export type VehicleImportExisting = VehicleSheetSnapshot & {
  id: string;
  /** Rider holding this vehicle today (`drivers.vehicle_id`), for undo + preview. */
  assigned_driver_id?: string | null;
};

/** Rider master, matched by MG ID (`drivers.employee_id`). */
export type VehicleDriverRef = { id: string; employee_id: string };

/** Vehicle company catalog row; the sheet accepts the key or either label. */
export type VehicleCompanyRef = { key: string; label_en?: string; label_ar?: string };

export type VehiclePartnerRef = { id: string; name: string };

export type VehicleImportContext = {
  drivers?: readonly VehicleDriverRef[];
  companies?: readonly VehicleCompanyRef[];
  partners?: readonly VehiclePartnerRef[];
};

export type VehicleImportDriverAction = "assign" | "clear" | "keep";

export type VehicleImportPreviewRow = {
  rowIndex: number;
  bikeId: string;
  status: "create" | "update" | "error";
  error: string | null;
  after: VehicleSheetSnapshot | null;
  before: VehicleSheetSnapshot | null;
  vehicleId: string | null;
  /** Rider the row asks for (`assign`), or null for keep/clear. */
  driverId: string | null;
  /** Rider holding the vehicle before this row ran. */
  driverBefore: string | null;
  driverAction: VehicleImportDriverAction;
  /** Fields the row explicitly cleared with `-`. */
  clearedFields: string[];
};

const ENUMS: Partial<Record<VehicleImportField, readonly string[]>> = {
  kind: ["bike", "car"],
  status: ["active", "suspended", "maintenance"],
  condition: [
    "running",
    "inventory_assembled",
    "sold",
    "deadstock",
    "stolen",
    "repair_required",
    "standby",
    "police_custody",
    "accident",
  ],
  fuelType: ["chip", "card"],
  fuelCompany: ["mus", "unp", "rscd"],
  carType: ["company", "rent", "maintenance"],
};

const ENUM_ERROR: Partial<Record<VehicleImportField, string>> = {
  kind: "invalid_kind",
  status: "invalid_status",
  condition: "invalid_condition",
  fuelType: "invalid_fuel_type",
  fuelCompany: "invalid_fuel_company",
  carType: "invalid_car_type",
  typeOfUse: "invalid_type_of_use",
};

const FALLBACK_USE_TYPES = ["operational", "trainer", "standby"] as const;

function normEnum(raw: string, allowed: readonly string[]): string | null {
  const text = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.find((item) => item === text) ?? null;
}

function normalizePlateKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function matchExisting(
  existing: VehicleImportExisting[],
  plate: string,
  slug: string,
): VehicleImportExisting | null {
  const plateKey = normalizePlateKey(plate);
  if (plateKey) {
    const byPlate = existing.find((row) => normalizePlateKey(row.reg_number) === plateKey);
    if (byPlate) return byPlate;
  }
  if (slug) {
    const byBike = existing.find((row) => row.bike_id === slug);
    if (byBike) return byBike;
  }
  return null;
}

function rowPlate(present: Partial<Record<VehicleImportField, string>>): string {
  const rawPlate = present.regNumber?.trim() ?? "";
  if (rawPlate) return rawPlate;
  const rawId = present.bikeId?.trim() ?? "";
  return isKuwaitPlate(rawId) ? rawId : "";
}

export function previewVehicleImport(
  input: {
    headers: string[];
    rows: string[][];
    existing: VehicleImportExisting[];
    allowedUseTypes?: string[];
  } & VehicleImportContext,
): { error: string | null; rows: VehicleImportPreviewRow[] } {
  const fieldIndex = new Map<VehicleImportField, number>();
  input.headers.forEach((header, index) => {
    const field = headerToField(header);
    if (field && !fieldIndex.has(field)) fieldIndex.set(field, index);
  });
  if (!fieldIndex.has("bikeId") && !fieldIndex.has("regNumber")) {
    return { error: "missing_vehicle_id_column", rows: [] };
  }

  const parsed = input.rows.map((row, rowIndex) => {
    const present: Partial<Record<VehicleImportField, string>> = {};
    for (const [field, index] of fieldIndex) {
      present[field] = cell(row, index);
    }
    const plate = rowPlate(present);
    const rawId = present.bikeId?.trim() ?? "";
    const slug = plate ? plateToBikeId(plate) : rawId;
    return { row, rowIndex, present, plate, slug };
  });

  const plateCounts = new Map<string, number>();
  for (const item of parsed) {
    const key = normalizePlateKey(item.plate);
    if (key) plateCounts.set(key, (plateCounts.get(key) ?? 0) + 1);
  }

  const useTypes = input.allowedUseTypes?.length
    ? input.allowedUseTypes
    : [...FALLBACK_USE_TYPES];

  const context: VehicleImportContext = {
    drivers: input.drivers ?? [],
    companies: input.companies ?? [],
    partners: input.partners ?? [],
  };
  const vehiclesByPlate = new Map<string, string>();
  for (const row of input.existing) {
    const key = normalizePlateKey(row.reg_number);
    if (key) vehiclesByPlate.set(key, row.id);
  }

  const rows: VehicleImportPreviewRow[] = [];
  for (const item of parsed) {
    if (!item.plate && !item.slug) continue;
    const existing = matchExisting(input.existing, item.plate, item.slug);
    const plate = item.plate || existing?.reg_number || "";
    const displayId = plate || item.slug;
    if (!plate) {
      rows.push(errorRow(item.rowIndex, displayId, "missing_fields", existing));
      continue;
    }
    if ((plateCounts.get(normalizePlateKey(plate)) ?? 0) > 1) {
      rows.push(errorRow(item.rowIndex, plate, "duplicate_plate", existing));
      continue;
    }
    const built = buildSnapshot(
      existing,
      { ...item.present, regNumber: plate, bikeId: plateToBikeId(plate) },
      useTypes,
      context,
      vehiclesByPlate,
    );
    if ("error" in built) {
      rows.push(errorRow(item.rowIndex, plate, built.error, existing));
      continue;
    }
    rows.push({
      rowIndex: item.rowIndex,
      bikeId: built.snapshot.bike_id,
      status: existing ? "update" : "create",
      error: null,
      after: built.snapshot,
      before: existing ? snapshotOf(existing) : null,
      vehicleId: existing?.id ?? null,
      driverId: built.driverId,
      driverBefore: existing?.assigned_driver_id ?? null,
      driverAction: built.driverAction,
      clearedFields: built.clearedFields,
    });
  }
  return { error: null, rows };
}

function errorRow(
  rowIndex: number,
  bikeId: string,
  error: string,
  existing: VehicleImportExisting | null,
): VehicleImportPreviewRow {
  return {
    rowIndex,
    bikeId,
    status: "error",
    error,
    after: null,
    before: existing ? snapshotOf(existing) : null,
    vehicleId: existing?.id ?? null,
    driverId: null,
    driverBefore: existing?.assigned_driver_id ?? null,
    driverAction: "keep",
    clearedFields: [],
  };
}

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return row[index] ?? "";
}

function snapshotOf(row: VehicleImportExisting): VehicleSheetSnapshot {
  const { id: _id, assigned_driver_id: _driver, ...snapshot } = row;
  return snapshot;
}

type BuildResult =
  | {
      snapshot: VehicleSheetSnapshot;
      driverId: string | null;
      driverAction: VehicleImportDriverAction;
      clearedFields: string[];
    }
  | { error: string };

type DateField = { value: string | null } | { error: "invalid_document_date" };

function patchDate(raw: string | undefined, fallback: string | null): DateField {
  const intent = dateCellIntent(raw);
  if (intent.kind === "invalid") return { error: "invalid_document_date" };
  if (intent.kind === "keep") return { value: fallback };
  if (intent.kind === "clear") return { value: null };
  return { value: intent.iso };
}

const CLEARABLE_FIELDS: readonly VehicleImportField[] = [
  "chassisNo",
  "kind",
  "make",
  "model",
  "modelYear",
  "condition",
  "chipNo",
  "fuelType",
  "fuelCompany",
  "carType",
  "typeOfUse",
  "locationText",
  "status",
  "fuelMonthlyLimitKwd",
  "driverEmployeeId",
  "companyKey",
  "ownerPartnerName",
  "registrationIssuedAt",
  "registrationExpiresAt",
  "insuranceIssuedAt",
  "insuranceExpiresAt",
  "replacesPlate",
  "replacementStartedAt",
];

export function buildSnapshot(
  existing: VehicleImportExisting | null,
  present: Partial<Record<VehicleImportField, string>>,
  allowedUseTypes: readonly string[] = FALLBACK_USE_TYPES,
  context: VehicleImportContext = {},
  vehiclesByPlate: ReadonlyMap<string, string> = new Map(),
): BuildResult {
  for (const field of Object.keys(ENUMS) as VehicleImportField[]) {
    const intent = cellIntent(present[field]);
    if (intent.kind !== "value") continue;
    const allowed = ENUMS[field];
    if (!allowed || !normEnum(intent.value, allowed)) {
      return { error: ENUM_ERROR[field] ?? "invalid_option" };
    }
  }

  const typeOfUseIntent = cellIntent(present.typeOfUse);
  if (typeOfUseIntent.kind === "value") {
    const normalized = normalizeEnumValue(typeOfUseIntent.value);
    const allowed =
      allowedUseTypes.includes(normalized) ||
      (USE_TYPE_KEY_RE.test(normalized) && allowedUseTypes.length === 0);
    if (!allowed) return { error: "invalid_type_of_use" };
  }

  const kindIntent = cellIntent(present.kind);
  const kind =
    kindIntent.kind === "value"
      ? normEnum(kindIntent.value, ENUMS.kind ?? []) === "car"
        ? "car"
        : "bike"
      : existing?.vehicle_type_key ?? "bike";

  const statusIntent = cellIntent(present.status);
  const statusRaw =
    statusIntent.kind === "value"
      ? normEnum(statusIntent.value, ENUMS.status ?? [])
      : statusIntent.kind === "clear"
        ? null
        : existing?.status ?? "active";
  const status =
    statusRaw === "suspended" || statusRaw === "maintenance" ? statusRaw : "active";

  const driverIntent = cellIntent(present.driverEmployeeId);
  let driverId: string | null = null;
  let driverAction: VehicleImportDriverAction = "keep";
  if (driverIntent.kind === "clear") driverAction = "clear";
  if (driverIntent.kind === "value") {
    const match = resolveDriver(driverIntent.value, context.drivers ?? []);
    if (match === "unknown") return { error: "unknown_driver" };
    if (match === "ambiguous") return { error: "ambiguous_driver" };
    driverId = match;
    driverAction = "assign";
  }

  const companyIntent = cellIntent(present.companyKey);
  let companyId = existing?.company_id ?? null;
  if (companyIntent.kind === "clear") companyId = null;
  if (companyIntent.kind === "value") {
    const key = resolveCompany(companyIntent.value, context.companies ?? []);
    if (!key) return { error: "unknown_company" };
    companyId = key;
  }

  const partnerIntent = cellIntent(present.ownerPartnerName);
  let ownerPartnerId = existing?.owner_partner_id ?? null;
  if (partnerIntent.kind === "clear") ownerPartnerId = null;
  if (partnerIntent.kind === "value") {
    const id = resolvePartner(partnerIntent.value, context.partners ?? []);
    if (!id) return { error: "unknown_partner" };
    ownerPartnerId = id;
  }

  const replacesIntent = cellIntent(present.replacesPlate);
  let replacesVehicleId = existing?.replaces_vehicle_id ?? null;
  let replacementStartedAt = existing?.replacement_started_at ?? null;
  if (replacesIntent.kind === "clear") {
    replacesVehicleId = null;
    replacementStartedAt = null;
  }
  if (replacesIntent.kind === "value") {
    const targetId = vehiclesByPlate.get(normalizePlateKey(replacesIntent.value));
    if (!targetId) return { error: "unknown_replacement" };
    if (existing && targetId === existing.id) return { error: "invalid_replacement" };
    replacesVehicleId = targetId;
  }

  const sinceIntent = dateCellIntent(present.replacementStartedAt);
  if (sinceIntent.kind === "invalid") return { error: "invalid_document_date" };
  if (sinceIntent.kind === "clear") replacementStartedAt = null;
  if (sinceIntent.kind === "value") replacementStartedAt = sinceIntent.iso;
  if (!replacesVehicleId) replacementStartedAt = null;

  const registrationIssued = patchDate(
    present.registrationIssuedAt,
    existing?.registration_issued_at ?? null,
  );
  if ("error" in registrationIssued) return registrationIssued;
  const registrationExpires = patchDate(
    present.registrationExpiresAt,
    existing?.registration_expires_at ?? null,
  );
  if ("error" in registrationExpires) return registrationExpires;
  const insuranceIssued = patchDate(
    present.insuranceIssuedAt,
    existing?.insurance_issued_at ?? null,
  );
  if ("error" in insuranceIssued) return insuranceIssued;
  const insuranceExpires = patchDate(
    present.insuranceExpiresAt,
    existing?.insurance_expires_at ?? null,
  );
  if ("error" in insuranceExpires) return insuranceExpires;
  if (expiryBeforeIssue(registrationIssued.value, registrationExpires.value)) {
    return { error: "expiry_before_issue" };
  }
  if (expiryBeforeIssue(insuranceIssued.value, insuranceExpires.value)) {
    return { error: "expiry_before_issue" };
  }

  const clearedFields = CLEARABLE_FIELDS.filter((field) => isCleared(present[field]));

  const regNumber = patchedText(present.regNumber, existing?.reg_number ?? null);
  const chassisNo = patchedText(present.chassisNo, existing?.chassis_no ?? null);
  const make = patchedText(present.make, existing?.make ?? null);
  const model = patchedText(present.model, existing?.model ?? null);
  const locationText = patchedText(present.locationText, existing?.location_text ?? null);
  const chipNo = patchedText(present.chipNo, existing?.chip_no ?? null);
  const yearText =
    patchedText(
      present.modelYear,
      existing?.model_year != null ? String(existing.model_year) : "",
    ) ?? "";
  const fuelText =
    patchedText(
      present.fuelMonthlyLimitKwd,
      existing?.fuel_monthly_limit_kwd != null
        ? String(existing.fuel_monthly_limit_kwd)
        : "",
    ) ?? "";

  const bikeId = plateToBikeId(regNumber ?? "");
  const formError = validateVehicleForm({
    bikeId,
    regNumber: regNumber ?? "",
    chassisNo: chassisNo ?? "",
    make: make ?? "",
    model: model ?? "",
    locationText: locationText ?? "",
    modelYear: yearText,
    chipNo: chipNo ?? "",
    fuelMonthlyLimitKwd: fuelText,
  });
  if (formError) return { error: formError };

  const condition = patchedEnum(present.condition, existing?.condition ?? null, isVehicleCondition);
  const fuelType = patchedEnum(present.fuelType, existing?.fuel_type ?? null, isVehicleFuelType);
  const fuelCompany = patchedEnum(
    present.fuelCompany,
    existing?.fuel_company ?? null,
    isVehicleFuelCompany,
  );
  const carType = patchedEnum(present.carType, existing?.car_type ?? null, isVehicleCarType);
  const typeOfUse = pickUseType(present.typeOfUse, existing?.type_of_use ?? null, allowedUseTypes);

  const fuelMonthly = fuelText
    ? Number(fuelText)
    : existing
      ? null
      : defaultFuelMonthlyLimit(kind);

  return {
    snapshot: {
      bike_id: bikeId,
      reg_number: regNumber,
      chassis_no: chassisNo,
      make,
      model,
      model_year: yearText ? Number(yearText) : null,
      vehicle_type_key: kind,
      project_type: carTypeToProjectType(carType),
      status,
      location_text: locationText,
      condition,
      car_type: carType,
      type_of_use: typeOfUse,
      fuel_type: fuelType,
      fuel_company: fuelCompany,
      chip_no: chipNo,
      fuel_monthly_limit_kwd: fuelMonthly,
      company_id: companyId,
      owner_partner_id: ownerPartnerId,
      registration_issued_at: registrationIssued.value,
      registration_expires_at: registrationExpires.value,
      insurance_issued_at: insuranceIssued.value,
      insurance_expires_at: insuranceExpires.value,
      replaces_vehicle_id: replacesVehicleId,
      replacement_started_at: replacementStartedAt,
    },
    driverId,
    driverAction,
    clearedFields,
  };
}

/** Use-type cell with the same blank/`-` rule as every other field. */
function pickUseType(
  raw: string | undefined,
  fallback: string | null,
  allowed: readonly string[],
): string | null {
  const intent = cellIntent(raw);
  if (intent.kind === "keep") return fallback;
  if (intent.kind === "clear") return null;
  const text = normalizeEnumValue(intent.value);
  return allowed.includes(text) || USE_TYPE_KEY_RE.test(text) ? text : null;
}

/**
 * MG ID → `drivers` row. Matching more than one non-archived rider on the same
 * `employee_id` is a row error — the import never guesses which one to touch.
 */
function resolveDriver(
  value: string,
  drivers: readonly VehicleDriverRef[],
): string | "unknown" | "ambiguous" {
  const key = lookupKey(value);
  const hits = drivers.filter((driver) => lookupKey(driver.employee_id) === key);
  if (hits.length === 0) return "unknown";
  const ids = new Set(hits.map((driver) => driver.id));
  if (ids.size > 1) return "ambiguous";
  return hits[0].id;
}

function resolveCompany(
  value: string,
  companies: readonly VehicleCompanyRef[],
): string | null {
  const key = lookupKey(value);
  const hit = companies.find(
    (company) =>
      lookupKey(company.key) === key ||
      lookupKey(company.label_en ?? "") === key ||
      lookupKey(company.label_ar ?? "") === key,
  );
  return hit ? hit.key : null;
}

function resolvePartner(value: string, partners: readonly VehiclePartnerRef[]): string | null {
  const key = lookupKey(value);
  const hit = partners.find((partner) => lookupKey(partner.name) === key);
  return hit ? hit.id : null;
}
