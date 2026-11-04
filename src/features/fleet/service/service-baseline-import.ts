import {
  resolveProgramRule,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import type { ScheduledProgramKey } from "./service-programs";
import type { MaintenanceScheduleRow } from "./types";

/**
 * The baseline importer.
 *
 * The client sends one sheet of cars — plate, chassis, model, current km, last
 * service km, last service date and the next km they expect — and the same sheet
 * comes back every time the fleet changes. So the importer has two jobs and both
 * of them matter:
 *
 *  1. **Never create a duplicate.** Every row is matched on plate *and* on
 *     chassis against the whole fleet before anything is created, so a car
 *     already held under a different plate is found, and a re-import after a
 *     plate change is found too.
 *  2. **Create a genuinely new car.** Nine plates in the client's sheet are not
 *     in the fleet and are not typos — the first alone carries 74,721 km and a
 *     service dated 18/10/2026. Skipping them would lose real history, so a row
 *     that matches neither identity becomes a `car` with the plate, chassis,
 *     make and model the sheet names.
 *
 * Everything here is pure: the preview is computed from the sheet plus the fleet
 * snapshot, and the apply step in `service-actions.ts` only writes what the
 * preview already decided.
 */

export const BASELINE_IMPORT_CAP = 3000;

/** The program the client's baseline sheet describes. */
export const BASELINE_PROGRAM_KEY: ScheduledProgramKey = "oil_change";

export type BaselineImportGroup = "plate" | "chassis" | "create" | "reject";

export type BaselineImportItem = {
  /** 1-based row number in the uploaded sheet. */
  sheetRow: number;
  group: BaselineImportGroup;
  plate: string;
  chassisNo: string | null;
  make: string | null;
  model: string | null;
  modelRaw: string | null;
  currentKm: number | null;
  lastServiceKm: number | null;
  /** Kuwait day `YYYY-MM-DD`. */
  lastServiceDay: string | null;
  /** The sheet's own `Next Km`, kept so a disagreement can be quoted. */
  nextKm: number | null;
  /** The resolved vehicle when the row matched one. */
  vehicleId: string | null;
  /** The plate the fleet holds when the match was by chassis. */
  matchedPlate: string | null;
  /** The interval the row was checked against, from the resolved rule. */
  kmInterval: number | null;
  /** `lastServiceKm + kmInterval` — what the sheet should have said. */
  expectedNextKm: number | null;
  nextKmDisagrees: boolean;
  /**
   * `Current KM` is below the last service figure, so the odometer write is
   * withheld for this row. The service history is still imported; only the
   * reading that would rewind the meter is blocked.
   */
  odometerBlocked: boolean;
  /** Human-readable notes: duplicate, mismatch, missing identity. */
  notes: string[];
};

export type BaselineImportPreview = {
  items: BaselineImportItem[];
  counts: Record<BaselineImportGroup, number> & { total: number };
  /** Rows whose `Next Km` disagrees with `last service + interval`. */
  nextKmMismatches: number;
  /**
   * Rows blocked because `Current KM` is **below** `last service`. One of the two
   * figures is wrong, so the row cannot be confirmed — it is rejected, counted
   * here, and must be corrected in the sheet.
   */
  kmBelowService: number;
  truncated: boolean;
  headerRow: number;
};

export type BaselineFleetVehicle = {
  id: string;
  plate: string;
  chassisNo: string | null;
  make: string | null;
  model: string | null;
  vehicleTypeKey: string | null;
  condition: string | null;
  zoneName: string | null;
  driverName: string | null;
  currentKm: number | null;
};

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

/** Plates keep their `/`; everything else about the spacing is noise. */
export function normalisePlate(value: unknown): string {
  return cell(value).toUpperCase().replace(/\s+/g, "");
}

export function normaliseChassis(value: unknown): string {
  return cell(value).toUpperCase().replace(/[\s-]+/g, "");
}

/** Thousands separators, a stray comma or ` km` must not turn 74,721 into NaN. */
export function parseKm(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const text = cell(value).replace(/,/g, "").replace(/\s*km$/i, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * A sheet date. Handles `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`, an `ExcelJS`
 * `Date` and a raw Excel serial number — the four shapes the client's own file
 * uses across its own columns.
 */
export function parseSheetDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 1 || value > 80000) return null;
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cell(value);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * `Toyota/Yaris` → Toyota + Yaris; `Changan - Alsvin` → Changan + Alsvin; a name
 * with no separator keeps the whole string as the model and leaves the make
 * null, because guessing a badge from a single word is how a Changan becomes a
 * Toyota.
 */
export function splitMakeModel(raw: string | null): { make: string | null; model: string | null } {
  const text = cell(raw);
  if (!text) return { make: null, model: null };
  const parts = text.split(/\s+\/\s+|\s+-\s+|\/|\s-\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { make: parts[0], model: parts.slice(1).join(" ") };
  return { make: null, model: text };
}


type BaselineHeader = {
  headerRow: number;
  plate: number;
  chassis: number;
  model: number;
  currentKm: number;
  lastServiceKm: number;
  lastServiceDay: number;
  nextKm: number;
};

const HEADER_MATCHERS: { key: keyof Omit<BaselineHeader, "headerRow">; re: RegExp }[] = [
  // Date before km: "last service date" must not be read as the km column.
  {
    key: "lastServiceDay",
    re: /^(last\s*service\s*date|last\s*service\s*on|last\s*date|last\s*service\s*\(date\))$/,
  },
  {
    key: "lastServiceKm",
    re: /^(last\s*service(\s*km)?|last\s*service\s*\(km\)|last\s*km|last\s*odometer)$/,
  },
  { key: "nextKm", re: /^(next\s*km|next\s*service\s*km|next\s*service|next\s*odometer|next)$/ },
  {
    key: "currentKm",
    re: /^(current\s*km|current\s*kilometers?|current\s*odometer|current|km|odometer)$/,
  },
  { key: "chassis", re: /^(chassis(\s*number)?|chassis\s*no|vin)$/ },
  {
    key: "plate",
    re: /^(plate(\s*number)?|plate\s*no|reg(istration)?(\s*number)?|reg_number|number\s*plate)$/,
  },
  { key: "model", re: /^(model|car\s*model|vehicle\s*model|make\s*\/?\s*model)$/ },
];

function findHeader(rows: readonly (readonly unknown[])[]): BaselineHeader {
  for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
    const row = rows[i] ?? [];
    const cells = row.map((value) => cell(value).toLowerCase().replace(/\s+/g, " "));
    const found: Partial<Record<keyof Omit<BaselineHeader, "headerRow">, number>> = {};
    for (const matcher of HEADER_MATCHERS) {
      if (found[matcher.key] != null) continue;
      const index = cells.findIndex((value) => matcher.re.test(value));
      if (index >= 0) found[matcher.key] = index;
    }
    if (found.plate != null) {
      return {
        headerRow: i,
        plate: found.plate,
        chassis: found.chassis ?? -1,
        model: found.model ?? -1,
        currentKm: found.currentKm ?? -1,
        lastServiceKm: found.lastServiceKm ?? -1,
        lastServiceDay: found.lastServiceDay ?? -1,
        nextKm: found.nextKm ?? -1,
      };
    }
  }
  // No recognisable header: the client's own column order, plate first.
  return {
    headerRow: -1,
    plate: 0,
    chassis: 1,
    model: 2,
    currentKm: 3,
    lastServiceKm: 4,
    lastServiceDay: 5,
    nextKm: 6,
  };
}

function valueAt(row: readonly unknown[], index: number): unknown {
  return index >= 0 ? row[index] : undefined;
}

/**
 * Preview the sheet against the fleet.
 *
 * Each identity is tested against the **whole** fleet, not against whichever
 * vehicle the previous test happened to find, so a car held under a different
 * plate is still found by its chassis and a plate change does not create a
 * second row.
 */
export function previewBaselineImport(
  rows: readonly (readonly unknown[])[],
  fleet: readonly BaselineFleetVehicle[],
  rules: readonly MaintenanceScheduleRow[],
): BaselineImportPreview {
  const header = findHeader(rows);
  const byPlate = new Map<string, BaselineFleetVehicle>();
  const byChassis = new Map<string, BaselineFleetVehicle>();
  for (const vehicle of fleet) {
    const plate = normalisePlate(vehicle.plate);
    if (plate) byPlate.set(plate, vehicle);
    const chassis = normaliseChassis(vehicle.chassisNo);
    if (chassis) byChassis.set(chassis, vehicle);
  }

  const claimedPlate = new Map<string, number>();
  const claimedChassis = new Map<string, number>();
  const items: BaselineImportItem[] = [];
  const counts = { plate: 0, chassis: 0, create: 0, reject: 0, total: 0 };
  let nextKmMismatches = 0;
  let kmBelowService = 0;
  let truncated = false;

  for (let i = header.headerRow + 1; i < rows.length; i += 1) {
    if (items.length >= BASELINE_IMPORT_CAP) {
      truncated = true;
      break;
    }
    const row = rows[i] ?? [];
    const sheetRow = i + 1;
    const plate = normalisePlate(valueAt(row, header.plate));
    const chassisNo = normaliseChassis(valueAt(row, header.chassis)) || null;
    const modelRaw = cell(valueAt(row, header.model)) || null;
    // `0` is this sheet's sentinel for "no reading", not a 0 km car or a 0 km
    // service — no vehicle in this fleet is at zero, and reading the zeros
    // literally made 13 rows look like a `Next Km` disagreement and 2 look like a
    // rewound odometer.
    const rawCurrentKm = parseKm(valueAt(row, header.currentKm));
    const currentKm = rawCurrentKm === 0 ? null : rawCurrentKm;
    const rawLastServiceKm = parseKm(valueAt(row, header.lastServiceKm));
    const lastServiceKm = rawLastServiceKm === 0 ? null : rawLastServiceKm;
    const lastServiceDay = parseSheetDate(valueAt(row, header.lastServiceDay));
    const rawNextKm = parseKm(valueAt(row, header.nextKm));
    const nextKm = rawNextKm === 0 ? null : rawNextKm;
    const split = splitMakeModel(modelRaw);

    // A row that carries nothing at all is a gap in the sheet, not a rejection.
    if (!plate && !chassisNo && !modelRaw && currentKm == null && lastServiceKm == null) continue;

    const base = {
      sheetRow,
      plate,
      chassisNo,
      make: split.make,
      model: split.model,
      modelRaw,
      currentKm,
      lastServiceKm,
      lastServiceDay,
      nextKm,
      vehicleId: null,
      matchedPlate: null,
      kmInterval: null,
      expectedNextKm: null,
      nextKmDisagrees: false,
      odometerBlocked: false,
    } satisfies Omit<BaselineImportItem, "group" | "notes">;

    // The two in-file duplicate guards run before any match, so the first row
    // owns the vehicle and the second is reported instead of overwriting it.
    const duplicate =
      !plate
        ? "missing_plate"
        : claimedPlate.has(plate)
          ? `duplicate_plate_of_row_${claimedPlate.get(plate)}`
          : chassisNo && claimedChassis.has(chassisNo)
            ? `duplicate_chassis_of_row_${claimedChassis.get(chassisNo)}`
            : null;

    if (duplicate) {
      items.push({ ...base, group: "reject", notes: [duplicate] });
      counts.reject += 1;
      counts.total += 1;
      continue;
    }
    claimedPlate.set(plate, sheetRow);
    if (chassisNo) claimedChassis.set(chassisNo, sheetRow);

    const notes: string[] = [];

    // A baseline cannot be newer than the odometer. When the sheet says the car is
    // at 424,424 km but was serviced at 445,000 km, one of the two figures is
    // wrong — so this row's **odometer write is blocked** until the sheet is
    // confirmed. The service history is still imported (it is a record of what was
    // done, and the vehicle may be one of the nine the fleet does not hold yet),
    // because discarding the row would lose a real car and a real service.
    const odometerBlocked =
      currentKm != null && lastServiceKm != null && currentKm < lastServiceKm;
    if (odometerBlocked) {
      kmBelowService += 1;
      notes.push(`current_km_below_last_service_${currentKm}_lt_${lastServiceKm}`);
    }

    const plateMatch = byPlate.get(plate) ?? null;
    const chassisMatch = chassisNo ? byChassis.get(chassisNo) ?? null : null;
    const match = plateMatch ?? chassisMatch;
    const group: BaselineImportGroup = plateMatch ? "plate" : chassisMatch ? "chassis" : "create";
    // A chassis match under another plate is surfaced, but the fleet's own plate
    // is never rewritten from a spreadsheet.
    if (group === "chassis" && match) notes.push(`plate_in_fleet_is_${normalisePlate(match.plate)}`);

    const probe: MaintenanceVehicle = match
      ? {
          id: match.id,
          plate: match.plate,
          chassisNo: match.chassisNo,
          make: match.make ?? split.make,
          model: match.model ?? split.model,
          condition: match.condition,
          vehicleTypeKey: match.vehicleTypeKey ?? "car",
          zoneName: match.zoneName,
          driverName: match.driverName,
          currentKm: match.currentKm,
        }
      : {
          id: `new:${plate}`,
          plate,
          chassisNo,
          make: split.make,
          model: split.model,
          condition: "running",
          vehicleTypeKey: "car",
          zoneName: null,
          driverName: null,
          currentKm,
        };

    const rule = resolveProgramRule(probe, BASELINE_PROGRAM_KEY, rules);
    const kmInterval = rule && rule.kmInterval > 0 ? rule.kmInterval : null;
    const expectedNextKm =
      kmInterval != null && lastServiceKm != null ? lastServiceKm + kmInterval : null;
    // The sheet's own `Next Km` is checked against the approved interval rather
    // than trusted, so a disagreement is reported instead of silently accepted.
    const nextKmDisagrees =
      expectedNextKm != null && nextKm != null && Math.abs(expectedNextKm - nextKm) > 1;
    if (nextKmDisagrees) {
      nextKmMismatches += 1;
      notes.push(`next_km_expected_${expectedNextKm}`);
    }

    items.push({
      ...base,
      group,
      vehicleId: match?.id ?? null,
      matchedPlate: match?.plate ?? null,
      kmInterval,
      expectedNextKm,
      nextKmDisagrees,
      odometerBlocked,
      notes,
    });
    counts[group] += 1;
    counts.total += 1;
  }

  return {
    items,
    counts,
    nextKmMismatches,
    kmBelowService,
    truncated,
    headerRow: header.headerRow,
  };
}

