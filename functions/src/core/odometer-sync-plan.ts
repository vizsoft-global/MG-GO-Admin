/**
 * The pure half of the dashcam odometer sync.
 *
 * Kept apart from the scheduled function so the matching rules — chassis first,
 * then the normalised plate, and the monotonic guard that refuses to rewind a
 * reading — can be tested without a Firestore, a network or a cron trigger.
 */

export type OdometerSyncConfigShape = {
  odometer_field: string;
  plate_field: string;
  chassis_field: string;
};

export type FleetOdometerVehicle = {
  id: string;
  plate: string;
  chassisNo: string | null;
  currentKm: number | null;
  archived?: boolean;
};

export type PlannedOdometerReading = {
  vehicleId: string;
  km: number;
};

export type OdometerSyncPlan = {
  writes: PlannedOdometerReading[];
  skipped: number;
  unmatched: number;
  rows: number;
};

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalisePlate(value: unknown): string {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function normaliseChassis(value: unknown): string {
  return text(value).toUpperCase().replace(/[\s-]+/g, "");
}

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** The first array of objects anywhere in the payload — `data`, `rows`, `result`. */
export function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "rows", "result", "list", "items", "vehicles"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
      );
    }
    if (value && typeof value === "object") {
      const nested = rowsOf(value);
      if (nested.length > 0) return nested;
    }
  }
  return [record];
}

/**
 * Decide which readings may be written.
 *
 * Chassis is tested first because a plate can be re-issued; the normalised plate
 * is the fallback. A row that matches neither is counted and never guessed by
 * model, and a reading at or below what we hold is **skipped**, not written —
 * a rewind would hide every overdue service behind a fresh-looking baseline.
 */
export function planOdometerReadings(
  rows: readonly Record<string, unknown>[],
  fleet: readonly FleetOdometerVehicle[],
  config: OdometerSyncConfigShape,
): OdometerSyncPlan {
  const byChassis = new Map<string, FleetOdometerVehicle>();
  const byPlate = new Map<string, FleetOdometerVehicle>();
  for (const vehicle of fleet) {
    if (vehicle.archived) continue;
    const chassis = normaliseChassis(vehicle.chassisNo);
    if (chassis) byChassis.set(chassis, vehicle);
    const plate = normalisePlate(vehicle.plate);
    if (plate) byPlate.set(plate, vehicle);
  }

  const writes: PlannedOdometerReading[] = [];
  let skipped = 0;
  let unmatched = 0;

  for (const row of rows) {
    const chassis = normaliseChassis(row[config.chassis_field]);
    const plate = normalisePlate(row[config.plate_field]);
    const match =
      (chassis ? byChassis.get(chassis) : undefined) ?? (plate ? byPlate.get(plate) : undefined);
    if (!match) {
      unmatched += 1;
      continue;
    }
    const reading = numberOrNull(row[config.odometer_field]);
    if (reading == null) {
      skipped += 1;
      continue;
    }
    if (match.currentKm != null && reading <= match.currentKm) {
      skipped += 1;
      continue;
    }
    writes.push({ vehicleId: match.id, km: reading });
    // Keep the in-memory figure current so two rows for one vehicle cannot both
    // pass the guard and leave the lower reading written last.
    match.currentKm = reading;
  }

  return { writes, skipped, unmatched, rows: rows.length };
}
