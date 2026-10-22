import {
  VEHICLE_CAR_TYPES,
  VEHICLE_CONDITIONS,
  VEHICLE_FUEL_COMPANIES,
  VEHICLE_FUEL_TYPES,
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
  "driverEmployeeId",
  "companyKey",
  "ownerPartnerName",
  "registrationIssuedAt",
  "registrationExpiresAt",
  "insuranceIssuedAt",
  "insuranceExpiresAt",
  "replacesPlate",
  "replacementStartedAt",
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
    allowed: "Kuwait plate, e.g. 5/6767. Unique Vehicle ID. Also accepted as Plate.",
    example: "5/6767",
  },
  {
    field: "regNumber",
    header: "Plate",
    required: false,
    pinned: false,
    allowed: "Same as Vehicle ID. If both are filled, Plate wins.",
    example: "5/6767",
  },
  {
    field: "chassisNo",
    header: "Chassis No.",
    required: false,
    pinned: false,
    allowed: "6–17 letters or numbers. Blank keeps, - clears.",
    example: "MD2A16CY0PWH12345",
  },
  {
    field: "kind",
    header: "Kind",
    required: false,
    pinned: false,
    allowed: KIND.join(", ") + ". Blank on a new row is bike; an update keeps the kind.",
    example: "bike",
  },
  {
    field: "make",
    header: "Make",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, hyphen. Blank keeps, - clears.",
    example: "Honda",
  },
  {
    field: "model",
    header: "Model",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, hyphen. Blank keeps, - clears.",
    example: "Wave",
  },
  {
    field: "modelYear",
    header: "Year",
    required: false,
    pinned: false,
    allowed: "1990–2100. Blank keeps, - clears.",
    example: "2024",
  },
  {
    field: "condition",
    header: "Condition",
    required: false,
    pinned: false,
    allowed: VEHICLE_CONDITIONS.join(", ") + ". Blank keeps, - clears.",
    example: "running",
  },
  {
    field: "chipNo",
    header: "Chip No.",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, hyphen. Blank keeps, - clears.",
    example: "CHIP-1",
  },
  {
    field: "fuelType",
    header: "Fuel Type",
    required: false,
    pinned: false,
    allowed: VEHICLE_FUEL_TYPES.join(", ") + ". Blank keeps, - clears.",
    example: "chip",
  },
  {
    field: "fuelCompany",
    header: "Fuel Company",
    required: false,
    pinned: false,
    allowed: VEHICLE_FUEL_COMPANIES.join(", ") + ". Blank keeps, - clears.",
    example: "mus",
  },
  {
    field: "carType",
    header: "Car Type",
    required: false,
    pinned: false,
    allowed: VEHICLE_CAR_TYPES.join(", ") + ". Blank keeps, - clears.",
    example: "company",
  },
  {
    field: "typeOfUse",
    header: "Type of Use",
    required: false,
    pinned: false,
    allowed:
      "Catalog key from Settings → Vehicle uses (seeded operational, trainer, standby). Blank keeps, - clears.",
    example: "operational",
  },
  {
    field: "locationText",
    header: "Location",
    required: false,
    pinned: false,
    allowed: "Letters, numbers, spaces, comma, hyphen. Blank keeps, - clears.",
    example: "Kuwait",
  },
  {
    field: "status",
    header: "Status",
    required: false,
    pinned: false,
    allowed: STATUS.join(", ") + ". Blank on a new row is active; an update keeps the status.",
    example: "active",
  },
  {
    field: "fuelMonthlyLimitKwd",
    header: "Monthly fuel limit (KWD)",
    required: false,
    pinned: false,
    allowed:
      "Number greater than 0. Blank keeps on an update; a new row uses 30 (bike) or 60 (car). - clears.",
    example: "30",
  },
  {
    field: "driverEmployeeId",
    header: "MG ID",
    required: false,
    pinned: false,
    allowed:
      "MG ID (employee_id) of the rider to assign. The rider must already exist. Blank keeps the current rider, - unassigns.",
    example: "MG-10231",
  },
  {
    field: "companyKey",
    header: "Vehicle Company",
    required: false,
    pinned: false,
    allowed:
      "Vehicle company key, or its English/Arabic name. Blank keeps the company, - clears it.",
    example: "musallam",
  },
  {
    field: "ownerPartnerName",
    header: "Partner",
    required: false,
    pinned: false,
    allowed: "Partner name from the partner list. Blank keeps the partner, - clears it.",
    example: "Musallam Group",
  },
  {
    field: "registrationIssuedAt",
    header: "Registration issued",
    required: false,
    pinned: false,
    allowed: "Date YYYY-MM-DD. Blank keeps the date, - clears it.",
    example: "2025-01-15",
  },
  {
    field: "registrationExpiresAt",
    header: "Registration expiry",
    required: false,
    pinned: false,
    allowed: "Date YYYY-MM-DD, on or after Registration issued. Blank keeps, - clears.",
    example: "2026-01-15",
  },
  {
    field: "insuranceIssuedAt",
    header: "Insurance issued",
    required: false,
    pinned: false,
    allowed: "Date YYYY-MM-DD. Blank keeps the date, - clears it.",
    example: "2025-02-01",
  },
  {
    field: "insuranceExpiresAt",
    header: "Insurance expiry",
    required: false,
    pinned: false,
    allowed: "Date YYYY-MM-DD, on or after Insurance issued. Blank keeps, - clears.",
    example: "2026-02-01",
  },
  {
    field: "replacesPlate",
    header: "Rep. Plate",
    required: false,
    pinned: false,
    allowed:
      "Plate of the vehicle this one replaces. That plate must exist. Blank keeps, - clears the replacement.",
    example: "5/6400",
  },
  {
    field: "replacementStartedAt",
    header: "Since",
    required: false,
    pinned: false,
    allowed:
      "Date YYYY-MM-DD the replacement started. Only used when Rep. Plate is filled. Blank keeps, - clears.",
    example: "2025-09-01",
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
  "mg id": "driverEmployeeId",
  "mg id.": "driverEmployeeId",
  "driver mg id": "driverEmployeeId",
  "employee id": "driverEmployeeId",
  "emp id": "driverEmployeeId",
  "driver employee id": "driverEmployeeId",
  "vehicle company": "companyKey",
  "vehicle company key": "companyKey",
  company: "companyKey",
  "owner partner": "ownerPartnerName",
  partner: "ownerPartnerName",
  "registration issued": "registrationIssuedAt",
  "registration issue date": "registrationIssuedAt",
  "reg. issued": "registrationIssuedAt",
  "reg issued": "registrationIssuedAt",
  "registration expiry": "registrationExpiresAt",
  "registration expires": "registrationExpiresAt",
  "registration expiration": "registrationExpiresAt",
  "reg. expiry": "registrationExpiresAt",
  "reg expiry": "registrationExpiresAt",
  "insurance issued": "insuranceIssuedAt",
  "insurance issue date": "insuranceIssuedAt",
  "ins. issued": "insuranceIssuedAt",
  "ins issued": "insuranceIssuedAt",
  "insurance expiry": "insuranceExpiresAt",
  "insurance expires": "insuranceExpiresAt",
  "insurance expiration": "insuranceExpiresAt",
  "ins. expiry": "insuranceExpiresAt",
  "ins expiry": "insuranceExpiresAt",
  "rep. plate": "replacesPlate",
  "rep plate": "replacesPlate",
  "replaces plate": "replacesPlate",
  "replaced plate": "replacesPlate",
  since: "replacementStartedAt",
  "replacement since": "replacementStartedAt",
  "replacement started": "replacementStartedAt",
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
