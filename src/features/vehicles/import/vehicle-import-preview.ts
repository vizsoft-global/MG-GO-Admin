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
};

export type VehicleImportExisting = VehicleSheetSnapshot & { id: string };

export type VehicleImportPreviewRow = {
  rowIndex: number;
  bikeId: string;
  status: "create" | "update" | "error";
  error: string | null;
  after: VehicleSheetSnapshot | null;
  before: VehicleSheetSnapshot | null;
  vehicleId: string | null;
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

function textOrNull(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
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

export function previewVehicleImport(input: {
  headers: string[];
  rows: string[][];
  existing: VehicleImportExisting[];
  allowedUseTypes?: string[];
}): { error: string | null; rows: VehicleImportPreviewRow[] } {
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
    const built = buildSnapshot(existing, { ...item.present, regNumber: plate, bikeId: plateToBikeId(plate) }, useTypes);
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
  };
}

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return row[index] ?? "";
}

function snapshotOf(row: VehicleImportExisting): VehicleSheetSnapshot {
  const { id: _id, ...snapshot } = row;
  return snapshot;
}

export function buildSnapshot(
  existing: VehicleImportExisting | null,
  present: Partial<Record<VehicleImportField, string>>,
  allowedUseTypes: readonly string[] = FALLBACK_USE_TYPES,
): { snapshot: VehicleSheetSnapshot } | { error: string } {
  for (const field of Object.keys(ENUMS) as VehicleImportField[]) {
    const raw = present[field];
    if (raw == null || !raw.trim()) continue;
    const allowed = ENUMS[field];
    if (!allowed || !normEnum(raw, allowed)) {
      return { error: ENUM_ERROR[field] ?? "invalid_option" };
    }
  }

  const typeOfUseRaw = present.typeOfUse?.trim();
  if (typeOfUseRaw) {
    const normalized = typeOfUseRaw.toLowerCase().replace(/[\s-]+/g, "_");
    const allowed =
      allowedUseTypes.includes(normalized) ||
      (USE_TYPE_KEY_RE.test(normalized) && allowedUseTypes.length === 0);
    if (!allowed) return { error: "invalid_type_of_use" };
  }

  const kind = present.kind?.trim()
    ? normEnum(present.kind, ENUMS.kind ?? []) === "car"
      ? "car"
      : "bike"
    : existing?.vehicle_type_key ?? "bike";

  const statusRaw = present.status?.trim()
    ? normEnum(present.status, ENUMS.status ?? [])
    : existing?.status ?? "active";
  const status =
    statusRaw === "suspended" || statusRaw === "maintenance" ? statusRaw : "active";

  const regNumber = pickText(present, "regNumber", existing?.reg_number ?? null);
  const chassisNo = pickText(present, "chassisNo", existing?.chassis_no ?? null);
  const make = pickText(present, "make", existing?.make ?? null);
  const model = pickText(present, "model", existing?.model ?? null);
  const locationText = pickText(present, "locationText", existing?.location_text ?? null);
  const chipNo = pickText(present, "chipNo", existing?.chip_no ?? null);
  const yearText =
    present.modelYear !== undefined
      ? present.modelYear.trim()
      : existing?.model_year != null
        ? String(existing.model_year)
        : "";
  const fuelText =
    present.fuelMonthlyLimitKwd !== undefined
      ? present.fuelMonthlyLimitKwd.trim()
      : existing?.fuel_monthly_limit_kwd != null
        ? String(existing.fuel_monthly_limit_kwd)
        : "";

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

  const condition = pickEnum(present.condition, existing?.condition ?? null, isVehicleCondition);
  const fuelType = pickEnum(present.fuelType, existing?.fuel_type ?? null, isVehicleFuelType);
  const fuelCompany = pickEnum(
    present.fuelCompany,
    existing?.fuel_company ?? null,
    isVehicleFuelCompany,
  );
  const carType = pickEnum(present.carType, existing?.car_type ?? null, isVehicleCarType);
  const typeOfUse = pickUseType(present.typeOfUse, existing?.type_of_use ?? null, allowedUseTypes);

  const fuelMonthly =
    present.fuelMonthlyLimitKwd === undefined
      ? existing?.fuel_monthly_limit_kwd ?? defaultFuelMonthlyLimit(kind)
      : fuelText
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
    },
  };
}

function pickText(
  present: Partial<Record<VehicleImportField, string>>,
  field: VehicleImportField,
  fallback: string | null,
): string | null {
  if (present[field] === undefined) return fallback;
  return textOrNull(present[field]);
}

function pickEnum<T extends string>(
  raw: string | undefined,
  fallback: string | null,
  guard: (value: string | null | undefined) => value is T,
): T | null {
  if (raw === undefined) return guard(fallback) ? fallback : null;
  const text = raw.trim();
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[\s-]+/g, "_");
  return guard(normalized) ? normalized : null;
}

function pickUseType(
  raw: string | undefined,
  fallback: string | null,
  allowed: readonly string[],
): string | null {
  if (raw === undefined) return fallback;
  const text = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return null;
  return allowed.includes(text) || USE_TYPE_KEY_RE.test(text) ? text : null;
}
