import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  isVehicleCarType,
  isVehicleCondition,
  isVehicleFuelCompany,
  isVehicleFuelType,
  isVehicleTypeOfUse,
} from "@/features/fleet/fleet-labels";
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
  typeOfUse: ["operational", "trainer", "standby"],
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

function normEnum(raw: string, allowed: readonly string[]): string | null {
  const text = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.find((item) => item === text) ?? null;
}

function textOrNull(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}

export function previewVehicleImport(input: {
  headers: string[];
  rows: string[][];
  existing: VehicleImportExisting[];
}): { error: string | null; rows: VehicleImportPreviewRow[] } {
  const fieldIndex = new Map<VehicleImportField, number>();
  input.headers.forEach((header, index) => {
    const field = headerToField(header);
    if (field && !fieldIndex.has(field)) fieldIndex.set(field, index);
  });
  if (!fieldIndex.has("bikeId")) return { error: "missing_vehicle_id_column", rows: [] };

  const byBike = new Map(input.existing.map((row) => [row.bike_id, row]));
  const counts = new Map<string, number>();
  const parsed = input.rows.map((row, rowIndex) => {
    const bikeId = cell(row, fieldIndex.get("bikeId")).trim();
    if (bikeId) counts.set(bikeId, (counts.get(bikeId) ?? 0) + 1);
    return { row, rowIndex, bikeId };
  });

  const rows: VehicleImportPreviewRow[] = [];
  for (const item of parsed) {
    if (!item.bikeId) continue;
    const existing = byBike.get(item.bikeId) ?? null;
    if ((counts.get(item.bikeId) ?? 0) > 1) {
      rows.push(errorRow(item.rowIndex, item.bikeId, "duplicate_in_file", existing));
      continue;
    }
    const present: Partial<Record<VehicleImportField, string>> = {};
    for (const [field, index] of fieldIndex) {
      present[field] = cell(item.row, index);
    }
    const built = buildSnapshot(existing, present);
    if ("error" in built) {
      rows.push(errorRow(item.rowIndex, item.bikeId, built.error, existing));
      continue;
    }
    rows.push({
      rowIndex: item.rowIndex,
      bikeId: item.bikeId,
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
): { snapshot: VehicleSheetSnapshot } | { error: string } {
  for (const field of Object.keys(ENUMS) as VehicleImportField[]) {
    const raw = present[field];
    if (raw == null || !raw.trim()) continue;
    const allowed = ENUMS[field];
    if (!allowed || !normEnum(raw, allowed)) {
      return { error: ENUM_ERROR[field] ?? "invalid_option" };
    }
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

  const formError = validateVehicleForm({
    bikeId: present.bikeId?.trim() || existing?.bike_id || "",
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
  const typeOfUse = pickEnum(
    present.typeOfUse,
    existing?.type_of_use ?? null,
    isVehicleTypeOfUse,
  );

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
      bike_id: (present.bikeId ?? existing?.bike_id ?? "").trim(),
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
