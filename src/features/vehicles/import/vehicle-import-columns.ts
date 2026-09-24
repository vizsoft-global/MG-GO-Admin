import {
  VEHICLE_CAR_TYPES,
  VEHICLE_CONDITIONS,
  VEHICLE_FUEL_COMPANIES,
  VEHICLE_FUEL_TYPES,
  VEHICLE_TYPES_OF_USE,
} from "@/features/fleet/fleet-labels";

export const VEHICLE_IMPORT_FIELDS = [
  "bikeId",
  "regNumber",
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
] as const;

export type VehicleImportField = (typeof VEHICLE_IMPORT_FIELDS)[number];

export type VehicleImportColumn = {
  field: VehicleImportField;
  header: string;
  required: boolean;
  pinned: boolean;
  allowed: string;
  example: string;
};

const KIND = ["bike", "car"] as const;
const STATUS = ["active", "suspended", "maintenance"] as const;

export const VEHICLE_IMPORT_COLUMNS: readonly VehicleImportColumn[] = [
  {
    field: "bikeId",
    header: "Vehicle ID",
    required: true,
    pinned: true,
    allowed: "Letters, numbers, hyphen, underscore. Max 32. Match key.",
    example: "TEST-FLEET-01",
  },
  {
    field: "regNumber",
    header: "Plate No.",
    required: false,
    pinned: false,
    allowed: "Digits and one slash, e.g. 5/6767. Blank clears.",
    example: "5/6767",
  },
  {
    field: "chassisNo",
    header: "Chassis No.",
    required: false,
    pinned: false,
    allowed: "6–17 letters or numbers. Blank clears.",
    example: "MD2A16CY0PWH12345",
  },
  {
    field: "kind",
    header: "Kind",
    required: false,
    pinned: false,
    allowed: KIND.join(", ") + ". Blank on a new row is bike.",
    example: "bike",
  },
  {
    field: "make",
    header: "Make",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, hyphen. Blank clears.",
    example: "Honda",
  },
  {
    field: "model",
    header: "Model",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, hyphen. Blank clears.",
    example: "Wave",
  },
  {
    field: "modelYear",
    header: "Year",
    required: false,
    pinned: false,
    allowed: "1990–2100. Blank clears.",
    example: "2024",
  },
  {
    field: "condition",
    header: "Condition",
    required: false,
    pinned: false,
    allowed: VEHICLE_CONDITIONS.join(", "),
    example: "running",
  },
  {
    field: "chipNo",
    header: "Chip No.",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, hyphen. Blank clears.",
    example: "CHIP-1",
  },
  {
    field: "fuelType",
    header: "Fuel Type",
    required: false,
    pinned: false,
    allowed: VEHICLE_FUEL_TYPES.join(", "),
    example: "chip",
  },
  {
    field: "fuelCompany",
    header: "Fuel Company",
    required: false,
    pinned: false,
    allowed: VEHICLE_FUEL_COMPANIES.join(", "),
    example: "mus",
  },
  {
    field: "carType",
    header: "Car Type",
    required: false,
    pinned: false,
    allowed: VEHICLE_CAR_TYPES.join(", "),
    example: "company",
  },
  {
    field: "typeOfUse",
    header: "Type of Use",
    required: false,
    pinned: false,
    allowed: VEHICLE_TYPES_OF_USE.join(", "),
    example: "operational",
  },
  {
    field: "locationText",
    header: "Location",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, comma, hyphen. Blank clears.",
    example: "Kuwait",
  },
  {
    field: "status",
    header: "Status",
    required: false,
    pinned: false,
    allowed: STATUS.join(", ") + ". Blank on a new row is active.",
    example: "active",
  },
  {
    field: "fuelMonthlyLimitKwd",
    header: "Monthly fuel limit (KWD)",
    required: false,
    pinned: false,
    allowed: "Number greater than 0. Blank on a new row uses 30 (bike) or 60 (car).",
    example: "30",
  },
];

const HEADER_ALIASES: Record<string, VehicleImportField> = {
  "vehicle id": "bikeId",
  "bike id": "bikeId",
  bike_id: "bikeId",
  "plate no.": "regNumber",
  "plate no": "regNumber",
  plate: "regNumber",
  "reg number": "regNumber",
  "chassis no.": "chassisNo",
  "chassis no": "chassisNo",
  chassis: "chassisNo",
  kind: "kind",
  make: "make",
  model: "model",
  year: "modelYear",
  condition: "condition",
  "chip no.": "chipNo",
  "chip no": "chipNo",
  chip: "chipNo",
  "fuel type": "fuelType",
  "fuel company": "fuelCompany",
  "car type": "carType",
  "type of use": "typeOfUse",
  location: "locationText",
  status: "status",
  "monthly fuel limit (kwd)": "fuelMonthlyLimitKwd",
  "monthly fuel limit": "fuelMonthlyLimitKwd",
};

export function headerToField(header: string): VehicleImportField | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[key] ?? null;
}

export function columnByField(field: VehicleImportField): VehicleImportColumn {
  const column = VEHICLE_IMPORT_COLUMNS.find((item) => item.field === field);
  if (!column) throw new Error(`unknown vehicle import field ${field}`);
  return column;
}
