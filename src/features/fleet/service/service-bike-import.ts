import { PROGRAM_ALERT_DAYS, PROGRAM_ALERT_KM } from "./service-programs";

/**
 * The bike service-record importer.
 *
 * The client's end state is a direct read of Bajaj Care. There is no API
 * contract, credential or export in this repo, so this release does not block on
 * it: bikes get their records through an Excel/CSV sheet and through manual entry
 * on `/fleet/service/bikes`, and the three bike programs calculate from those
 * records exactly as they will from a Bajaj Care sync later.
 *
 * A car plate in a bike sheet is rejected loudly rather than written onto a bike
 * — the sheet is reused across departments and a silent mis-file would move a
 * bike's oil date with a car's service.
 */

export const BIKE_IMPORT_CAP = 2000;

/** Column order of the downloadable bike template. */
export const BIKE_IMPORT_HEADERS = [
  "plate",
  "service date",
  "service type",
  "odometer",
  "cost",
  "vendor",
  "invoice no",
  "notes",
] as const;

export type BikeImportGroup = "create" | "reject";

export type BikeImportItem = {
  sheetRow: number;
  group: BikeImportGroup;
  plate: string;
  vehicleId: string | null;
  matchedPlate: string | null;
  /** Kuwait day `YYYY-MM-DD`. */
  serviceDay: string | null;
  /** The scheduled program the record files under, or null when unrecognised. */
  programKey: "oil_change" | "brake" | "chain" | null;
  serviceTypeRaw: string;
  odometerKm: number | null;
  costKwd: number | null;
  vendor: string | null;
  invoiceNo: string | null;
  notes: string | null;
  /** One of `missing_plate`, `not_a_bike`, `unknown_service_type`, `invalid_date`, `future_date`, `unknown_plate`. */
  problem: string | null;
};

export type BikeImportPreview = {
  items: BikeImportItem[];
  counts: { create: number; reject: number; total: number };
  headerRow: number;
  truncated: boolean;
};

/** The three programs a bike record may file under, with the words the sheet uses. */
const BIKE_PROGRAM_ALIASES: { key: "oil_change" | "brake" | "chain"; re: RegExp }[] = [
  { key: "oil_change", re: /\b(oil|engine oil|oil change|oil filter|oil & filter)\b/ },
  { key: "brake", re: /\b(brake|brakes|brake pad|brake shoe|brake fluid)\b/ },
  { key: "chain", re: /\b(chain|chain adjust|chain lube|sprocket)\b/ },
];

export function bikeProgramFor(text: string): "oil_change" | "brake" | "chain" | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (value === "oil_change" || value === "brake" || value === "chain") return value;
  // A tyre program is a car program, so it can never resolve to a bike program.
  if (value === "tire_front" || value === "tire_rear") return null;
  for (const alias of BIKE_PROGRAM_ALIASES) {
    if (alias.re.test(value)) return alias.key;
  }
  return null;
}

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function normalisePlate(value: unknown): string {
  return cell(value).toUpperCase().replace(/\s+/g, "");
}

function normaliseChassis(value: unknown): string {
  return cell(value).toUpperCase().replace(/[\s-]+/g, "");
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(cell(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function sheetDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 1 && value < 80000) {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cell(value);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return null;
}


type BikeHeader = {
  headerRow: number;
  plate: number;
  serviceDay: number;
  serviceType: number;
  odometer: number;
  cost: number;
  vendor: number;
  invoiceNo: number;
  notes: number;
};

const BIKE_HEADERS: { key: keyof Omit<BikeHeader, "headerRow">; re: RegExp }[] = [
  { key: "serviceDay", re: /^(service\s*date|date|serviced|done\s*on)$/ },
  { key: "serviceType", re: /^(service\s*type|type|job|work)$/ },
  { key: "odometer", re: /^(odometer|km|odometer\s*\(km\)|reading)$/ },
  { key: "cost", re: /^(cost|cost\s*kwd|amount|total|price)$/ },
  { key: "vendor", re: /^(vendor|workshop|garage|supplier)$/ },
  { key: "invoiceNo", re: /^(invoice\s*no|invoice|invoice\s*number|bill\s*no)$/ },
  { key: "notes", re: /^(notes|note|remarks|comment)$/ },
  { key: "plate", re: /^(plate(\s*number)?|plate\s*no|reg(istration)?(\s*number)?|bike\s*id)$/ },
];

function findBikeHeader(rows: readonly (readonly unknown[])[]): BikeHeader {
  for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
    const row = rows[i] ?? [];
    const cells = row.map((value) => cell(value).toLowerCase().replace(/\s+/g, " "));
    const found: Partial<Record<keyof Omit<BikeHeader, "headerRow">, number>> = {};
    for (const matcher of BIKE_HEADERS) {
      if (found[matcher.key] != null) continue;
      const index = cells.findIndex((value) => matcher.re.test(value));
      if (index >= 0) found[matcher.key] = index;
    }
    if (found.plate != null) {
      return {
        headerRow: i,
        plate: found.plate,
        serviceDay: found.serviceDay ?? -1,
        serviceType: found.serviceType ?? -1,
        odometer: found.odometer ?? -1,
        cost: found.cost ?? -1,
        vendor: found.vendor ?? -1,
        invoiceNo: found.invoiceNo ?? -1,
        notes: found.notes ?? -1,
      };
    }
  }
  return {
    headerRow: -1,
    plate: 0,
    serviceDay: 1,
    serviceType: 2,
    odometer: 3,
    cost: 4,
    vendor: 5,
    invoiceNo: 6,
    notes: 7,
  };
}

export type BikeFleetVehicle = {
  id: string;
  plate: string;
  chassisNo: string | null;
  vehicleTypeKey: string | null;
};


/** Preview a bike sheet. Cars in the same sheet are rejected, never re-filed. */
export function previewBikeImport(
  rows: readonly (readonly unknown[])[],
  fleet: readonly BikeFleetVehicle[],
  today: string,
): BikeImportPreview {
  const header = findBikeHeader(rows);
  const bikes = fleet.filter((vehicle) => (vehicle.vehicleTypeKey ?? "").toLowerCase() === "bike");
  const cars = new Set(
    fleet
      .filter((vehicle) => (vehicle.vehicleTypeKey ?? "").toLowerCase() === "car")
      .flatMap((vehicle) => [normalisePlate(vehicle.plate), normaliseChassis(vehicle.chassisNo)]),
  );
  const byPlate = new Map<string, BikeFleetVehicle>();
  const byChassis = new Map<string, BikeFleetVehicle>();
  for (const bike of bikes) {
    const plate = normalisePlate(bike.plate);
    if (plate) byPlate.set(plate, bike);
    const chassis = normaliseChassis(bike.chassisNo);
    if (chassis) byChassis.set(chassis, bike);
  }

  const items: BikeImportItem[] = [];
  const counts = { create: 0, reject: 0, total: 0 };
  let truncated = false;

  for (let i = header.headerRow + 1; i < rows.length; i += 1) {
    if (items.length >= BIKE_IMPORT_CAP) {
      truncated = true;
      break;
    }
    const row = rows[i] ?? [];
    const plate = normalisePlate(row[header.plate >= 0 ? header.plate : 0]);
    const serviceTypeRaw = header.serviceType >= 0 ? cell(row[header.serviceType]) : "";
    const serviceDay = header.serviceDay >= 0 ? sheetDate(row[header.serviceDay]) : null;
    const odometerKm = header.odometer >= 0 ? numberOrNull(row[header.odometer]) : null;
    const costKwd = header.cost >= 0 ? numberOrNull(row[header.cost]) : null;
    const vendor = header.vendor >= 0 ? cell(row[header.vendor]) || null : null;
    const invoiceNo = header.invoiceNo >= 0 ? cell(row[header.invoiceNo]) || null : null;
    const notes = header.notes >= 0 ? cell(row[header.notes]) || null : null;

    if (!plate && !serviceTypeRaw && !serviceDay) continue;

    const programKey = bikeProgramFor(serviceTypeRaw);
    const match = plate ? byPlate.get(plate) ?? byChassis.get(plate) ?? null : null;

    let problem: string | null = null;
    if (!plate) problem = "missing_plate";
    else if (cars.has(plate)) problem = "not_a_bike";
    else if (!programKey) problem = "unknown_service_type";
    else if (!serviceDay) problem = "invalid_date";
    else if (serviceDay > today) problem = "future_date";
    else if (!match) problem = "unknown_plate";

    items.push({
      sheetRow: i + 1,
      group: problem ? "reject" : "create",
      plate,
      vehicleId: match?.id ?? null,
      matchedPlate: match?.plate ?? null,
      serviceDay,
      programKey,
      serviceTypeRaw,
      odometerKm,
      costKwd,
      vendor,
      invoiceNo,
      notes,
      problem,
    });
    if (problem) counts.reject += 1;
    else counts.create += 1;
    counts.total += 1;
  }

  return { items, counts, headerRow: header.headerRow, truncated };
}

/** The approved bike intervals, for the manual-entry hint on the bike page. */
export const BIKE_PROGRAM_DEFAULTS = [
  {
    key: "oil_change",
    kmInterval: 1500,
    dayInterval: 10,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
  },
  {
    key: "brake",
    kmInterval: 0,
    dayInterval: 45,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
  },
  {
    key: "chain",
    kmInterval: 0,
    dayInterval: 45,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
  },
] as const;
