import {
  curatedPrograms,
  curatedVehicleTypes,
  programApplies,
  vehicleTypeForPrograms,
  type MaintenanceProgram,
} from "./service-programs";
import type {
  MaintenanceExclusion,
  MaintenanceOverride,
  MaintenanceProgramRow,
  MaintenanceRuleScope,
  MaintenanceScheduleRow,
  MaintenanceSettings,
  MaintenanceStatus,
  VehicleDayDistance,
} from "./types";

/**
 * Fleet-default intervals. They are **provisional**: stored in
 * `service_maintenance_settings/current` with `provisional: true`, and only an
 * admin pressing "Confirm intervals" clears that flag. Nothing in this file
 * treats them as a business rule — the values come from the document, and this
 * object is only the seed the settings dialog writes when the document is empty.
 *
 * Since the client approved per-program intervals, the defaults are the last
 * resort for a vehicle × program the approved rules do not cover (a make with no
 * oil interval of its own). While `provisional` is true the banner keeps saying
 * so, which is exactly what those rows are.
 */
export const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  km_interval: 10000,
  day_interval: 180,
  alert_km: 500,
  alert_days: 5,
  provisional: true,
  approved_at: null,
  approved_by: null,
  updated_at: null,
  updated_by: null,
};

function keyify(value: string | null | undefined, limit = 60): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, limit);
}

export function makeModelKey(
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  return keyify(`${make ?? ""} ${model ?? ""}`);
}

/** A make on its own — the scope `Toyota` / `Hyundai` rules are keyed on. */
export function makeKey(make: string | null | undefined): string {
  return keyify(make);
}

export type MaintenanceVehicle = {
  id: string;
  plate: string;
  chassisNo: string | null;
  make: string | null;
  model: string | null;
  condition: string | null;
  vehicleTypeKey: string | null;
  zoneName: string | null;
  driverName: string | null;
  currentKm: number | null;
  /** ISO timestamp of the last reading, so a stale figure can be spotted. */
  odometerUpdatedAt?: string | null;
};

export type MaintenanceDoneRecord = {
  id: string;
  vehicleId: string;
  serviceTypeKey: string | null;
  /** Kuwait day `YYYY-MM-DD`. */
  doneDay: string;
  odometerKm: number | null;
};

/** One resolved rule for one vehicle × program. */
export type ResolvedProgramRule = {
  scope: MaintenanceRuleScope | "default";
  kmInterval: number;
  dayInterval: number;
  alertKm: number;
  alertDays: number;
  provisional: boolean;
};

/**
 * Narrowest scope wins: the vehicle's own rule, then its make/model, then its
 * make, then its vehicle type.
 *
 * There is **no fleet-default fallback**. The five programs are curated, and the
 * client approved intervals for specific makes and types: computing a due date
 * from an unapproved 10,000 km / 180 days default would be a guess dressed as a
 * measurement. A vehicle the approved rules do not cover gets a `no_rule` row —
 * a real state with a real action (add a rule) — and the fleet-default numbers
 * stay in `service_maintenance_settings` only as the seed a new rule starts from.
 *
 * The service type is part of the match, which is what makes oil, front tyres,
 * rear tyres and brakes independent of each other: they are four different
 * `service_type_key` values, so changing one interval cannot move another
 * program's due date.
 */
export function resolveProgramRule(
  vehicle: MaintenanceVehicle,
  programKey: string,
  rules: readonly MaintenanceScheduleRow[],
): ResolvedProgramRule | null {
  if (!programApplies(programKey, vehicle.vehicleTypeKey)) return null;

  const active = rules.filter((rule) => rule.is_active && rule.service_type_key === programKey);
  const modelKey = makeModelKey(vehicle.make, vehicle.model);
  const ownMake = makeKey(vehicle.make);
  const typeKey = vehicleTypeForPrograms(vehicle.vehicleTypeKey);

  const own = active.find((rule) => rule.scope === "vehicle" && rule.vehicle_id === vehicle.id);
  const model = modelKey
    ? active.find((rule) => rule.scope === "make_model" && rule.make_model_key === modelKey)
    : undefined;
  const make = ownMake
    ? active.find((rule) => rule.scope === "make" && rule.make_key === ownMake)
    : undefined;
  const type = typeKey
    ? active.find((rule) => rule.scope === "vehicle_type" && rule.vehicle_type_key === typeKey)
    : undefined;

  const chosen = own ?? model ?? make ?? type;
  if (!chosen) return null;

  return {
    scope: chosen.scope,
    kmInterval: Math.max(0, Math.round(chosen.km_interval)),
    dayInterval: Math.max(0, Math.round(chosen.day_interval)),
    alertKm: Math.max(0, Math.round(chosen.alert_km)),
    alertDays: Math.max(0, Math.round(chosen.alert_days)),
    // A rule the fleet team wrote is an approved rule, so it is never
    // provisional — only the fleet defaults could be, and they no longer decide.
    provisional: false,
  };
}

function utcMs(day: string): number {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return Number.NaN;
  return Date.UTC(year, month - 1, date);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number | null {
  const a = utcMs(from);
  const b = utcMs(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function addDays(day: string, delta: number): string {
  const base = utcMs(day);
  if (Number.isNaN(base)) return day;
  return new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How urgent a status is. `not_tracked` and `unknown` are outside the ladder:
 * "we do not track this" and "we cannot tell" are never a due date, so they
 * never win `worstStatus`.
 *
 * `needs_baseline` sits **above** `normal` on purpose: a program that is normal
 * on the kilometres but has no record to count its days from still needs an
 * operator to enter one last-service row, and printing "Normal" would hide that.
 * It sits **below** `due_soon` so a real countdown is never masked by a missing
 * baseline on the other dimension.
 */
const STATUS_RANK: Record<MaintenanceStatus, number> = {
  not_tracked: -3,
  unknown: -2,
  no_rule: -1,
  normal: 0,
  needs_baseline: 1,
  due_soon: 2,
  due: 3,
  overdue: 4,
};

/** Remaining kilometres → status. Negative is overdue; zero is due today. */
export function kmStatus(remainingKm: number | null, alertKm: number): MaintenanceStatus {
  if (remainingKm == null || !Number.isFinite(remainingKm)) return "unknown";
  if (remainingKm < 0) return "overdue";
  if (remainingKm === 0) return "due";
  if (remainingKm <= Math.max(alertKm, 0)) return "due_soon";
  return "normal";
}

export function timeStatus(remainingDays: number | null, alertDays: number): MaintenanceStatus {
  if (remainingDays == null || !Number.isFinite(remainingDays)) return "unknown";
  if (remainingDays < 0) return "overdue";
  if (remainingDays === 0) return "due";
  if (remainingDays <= Math.max(alertDays, 0)) return "due_soon";
  return "normal";
}

/**
 * The worse of the dimensions. A dimension the rule does not track is passed in
 * as `not_tracked` and can never win, and an unknown figure never outranks a
 * real one — so a program that only counts days is judged on days alone.
 */
export function worstStatus(statuses: readonly MaintenanceStatus[]): MaintenanceStatus {
  let worst: MaintenanceStatus | null = null;
  for (const status of statuses) {
    if (status === "unknown" || status === "not_tracked" || status === "no_rule") continue;
    if (worst === null || STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  if (worst !== null) return worst;
  if (statuses.includes("no_rule")) return "no_rule";
  return statuses.includes("not_tracked") ? "not_tracked" : "unknown";
}

export function statusRank(status: MaintenanceStatus): number {
  return STATUS_RANK[status] ?? -2;
}

export type MaintenanceBuildInput = {
  vehicles: readonly MaintenanceVehicle[];
  doneRecords: readonly MaintenanceDoneRecord[];
  schedules: readonly MaintenanceScheduleRow[];
  /**
   * The fleet-default intervals. **Not read here**: no row is ever judged by
   * them, because the five programs are curated and only an approved rule can
   * decide a due date. It stays on the input so a caller holding the settings
   * document can pass the object it already loaded.
   */
  settings?: MaintenanceSettings;
  /** `vehicle_maintenance_exclusions` — the fleet team's opt-outs. */
  exclusions?: readonly MaintenanceExclusion[];
  /** `vehicle_maintenance_overrides` — a next-service point set by hand. */
  overrides?: readonly MaintenanceOverride[];
  /**
   * The programs to draw — the curated five plus any catalog row flagged
   * `tracks_maintenance`. Defaults to the curated five.
   */
  programs?: readonly MaintenanceProgram[];
  /** `vehicle_day_distance` — the bike tab's "today" column. */
  distances?: readonly VehicleDayDistance[];
  /** Restrict the build to these vehicle types; the bike page passes `["bike"]`. */
  vehicleTypeKeys?: readonly string[];
  /** Kuwait today, `YYYY-MM-DD`. */
  today: string;
  /** `en` / `ar`, for the program label only. */
  locale?: string;
};

/** `vehicle_maintenance_exclusions` document id — one opt-out per vehicle × program. */
export function exclusionId(vehicleId: string, programKey: string): string {
  return `${vehicleId}_${programKey}`;
}

/** `vehicle_maintenance_overrides` document id — one hand-set point per vehicle × program. */
export function overrideId(vehicleId: string, programKey: string): string {
  return `${vehicleId}_${programKey}`;
}

function distanceFor(
  distances: readonly VehicleDayDistance[] | undefined,
  vehicleId: string,
  day: string,
): number | null {
  if (!distances || distances.length === 0) return null;
  const row = distances.find((entry) => entry.vehicleId === vehicleId && entry.day === day);
  return row ? Math.round(row.totalMeters) : null;
}

/**
 * One row per vehicle × program.
 *
 * This is the whole point of the rework: oil, front tyres, rear tyres, brakes and
 * the bike chain each resolve their own rule, read their own latest Done record
 * and are judged on their own dimensions. Nothing here can move another
 * program's date — the only shared input is the vehicle's odometer, which is a
 * measurement, not a rule.
 *
 * A program with **no rule at all** for this vehicle produces no row: the client
 * approved intervals for specific combinations, and inventing one for a make
 * they did not cover would be a guess dressed as a due date. A program that
 * resolves but has nothing to count from produces `needs_baseline`, which is a
 * real state an operator clears by entering one last-service line.
 */
export function buildProgramRows(input: MaintenanceBuildInput): MaintenanceProgramRow[] {
  const rows: MaintenanceProgramRow[] = [];
  const exclusions = input.exclusions ?? [];
  const overrides = input.overrides ?? [];
  const locale = input.locale ?? "en";
  const programs =
    input.programs && input.programs.length > 0 ? input.programs : curatedPrograms();
  // Every program an active rule names. A program the fleet team added to the
  // catalog is only scheduled somewhere a rule covers it, so it can never print
  // `no_rule` — that state belongs to the curated five, whose applicability is a
  // decision rather than an inference.
  const ruledKeys = new Set(
    input.schedules.filter((rule) => rule.is_active).map((rule) => rule.service_type_key),
  );
  const allowTypes =
    input.vehicleTypeKeys && input.vehicleTypeKeys.length > 0
      ? new Set(input.vehicleTypeKeys.map((key) => key.trim().toLowerCase()))
      : null;

  for (const vehicle of input.vehicles) {
    const typeKey = vehicleTypeForPrograms(vehicle.vehicleTypeKey);
    if (!typeKey) continue;
    if (allowTypes && !allowTypes.has(typeKey)) continue;

    for (const program of programs) {
      const programKey = program.key;
      const gatedTypes = curatedVehicleTypes(programKey);
      // A curated program keeps its own gating (no chains on a car); a catalog
      // program is decided by its rule, so nothing is filtered here for it.
      if (gatedTypes && !gatedTypes.includes(typeKey)) continue;
      if (!program.curated && !ruledKeys.has(programKey)) continue;

      const label = locale === "ar" ? program.labelAr || program.labelEn : program.labelEn;
      const todayMeters =
        typeKey === "bike" ? distanceFor(input.distances, vehicle.id, input.today) : null;
      const excluded = exclusions.some(
        (row) => row.vehicleId === vehicle.id && row.programKey === programKey,
      );

      if (excluded) {
        rows.push({
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          make: vehicle.make,
          model: vehicle.model,
          chassisNo: vehicle.chassisNo,
          condition: vehicle.condition,
          vehicleTypeKey: vehicle.vehicleTypeKey,
          zoneName: vehicle.zoneName,
          driverName: vehicle.driverName,
          currentKm: vehicle.currentKm,
          programKey,
          programLabel: label,
          lastServiceKm: null,
          lastServiceDate: null,
          nextDueKm: null,
          remainingKm: null,
          daysSinceService: null,
          nextDueDate: null,
          remainingDays: null,
          nextKmOverridden: false,
          nextDateOverridden: false,
          kmInterval: 0,
          dayInterval: 0,
          status: "not_tracked",
          byKm: "not_tracked",
          byTime: "not_tracked",
          needsSetup: false,
          needsOdometer: false,
          odometerUpdatedAt: vehicle.odometerUpdatedAt ?? null,
          provisional: false,
          ruleScope: "default",
          todayMeters,
        });
        continue;
      }

      const rule = resolveProgramRule(vehicle, programKey, input.schedules);
      if (!rule) {
        // The curated program is scheduled on this vehicle type but no approved
        // interval covers this vehicle. That is a state with an action, not a
        // number: printing a default-derived due date here would be a guess.
        rows.push({
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          make: vehicle.make,
          model: vehicle.model,
          chassisNo: vehicle.chassisNo,
          condition: vehicle.condition,
          vehicleTypeKey: vehicle.vehicleTypeKey,
          zoneName: vehicle.zoneName,
          driverName: vehicle.driverName,
          currentKm: vehicle.currentKm,
          programKey,
          programLabel: label,
          lastServiceKm: null,
          lastServiceDate: null,
          nextDueKm: null,
          remainingKm: null,
          daysSinceService: null,
          nextDueDate: null,
          remainingDays: null,
          nextKmOverridden: false,
          nextDateOverridden: false,
          kmInterval: 0,
          dayInterval: 0,
          status: "no_rule",
          byKm: "no_rule",
          byTime: "no_rule",
          needsSetup: false,
          needsOdometer: false,
          odometerUpdatedAt: vehicle.odometerUpdatedAt ?? null,
          provisional: false,
          ruleScope: "none",
          todayMeters,
        });
        continue;
      }

      const override =
        overrides.find(
          (row) => row.vehicleId === vehicle.id && row.programKey === programKey,
        ) ?? null;
      // A hand-set point makes that dimension tracked even when the rule says 0 —
      // "next oil at 92,000 km" is a real instruction, not an interval.
      const kmTracked = rule.kmInterval > 0 || override?.nextDueKm != null;
      const dayTracked = rule.dayInterval > 0 || override?.nextDueDate != null;
      // A rule that tracks neither dimension says nothing, so no row is printed
      // — exactly like a program with no rule, because neither can ever be due.
      if (!kmTracked && !dayTracked) continue;

      rows.push(
        programRow(input, vehicle, {
          programKey,
          label,
          rule,
          kmTracked,
          dayTracked,
          todayMeters,
          override,
        }),
      );
    }
  }
  return rows.sort(
    (a, b) => statusRank(b.status) - statusRank(a.status) || a.plate.localeCompare(b.plate),
  );
}

type ProgramRowParts = {
  programKey: string;
  label: string;
  rule: ResolvedProgramRule;
  kmTracked: boolean;
  dayTracked: boolean;
  todayMeters: number | null;
  override: MaintenanceOverride | null;
};

/** One vehicle × program, with each dimension judged on its own rule. */
function programRow(
  input: MaintenanceBuildInput,
  vehicle: MaintenanceVehicle,
  parts: ProgramRowParts,
): MaintenanceProgramRow {
  const baseline = baselineFor(input.doneRecords, vehicle.id, parts.programKey);
  const lastServiceKm = baseline?.odometerKm ?? null;
  const lastServiceDate = baseline?.doneDay ?? null;
  const currentKm = vehicle.currentKm;

  const derivedNextKm =
    parts.kmTracked && lastServiceKm != null && Number.isFinite(lastServiceKm)
      ? lastServiceKm + parts.rule.kmInterval
      : null;
  const derivedNextDate =
    parts.dayTracked && lastServiceDate
      ? addDays(lastServiceDate, parts.rule.dayInterval)
      : null;

  // A hand-set point wins over the derived one, per dimension: setting only the
  // date leaves the kilometres on the rule, and clearing one restores it.
  const overrideKm = parts.override?.nextDueKm ?? null;
  const overrideDate = parts.override?.nextDueDate ?? null;
  const nextDueKm = overrideKm ?? derivedNextKm;
  const nextDueDate = overrideDate ?? derivedNextDate;

  const remainingKm =
    nextDueKm != null && currentKm != null ? Math.round(currentKm - nextDueKm) : null;
  const remainingDays = nextDueDate ? daysBetween(input.today, nextDueDate) : null;
  const daysSinceService = lastServiceDate ? daysBetween(lastServiceDate, input.today) : null;

  const byKm: MaintenanceStatus = !parts.kmTracked
    ? "not_tracked"
    : nextDueKm == null
      ? "needs_baseline"
      : kmStatus(remainingKm, parts.rule.alertKm);
  const byTime: MaintenanceStatus = !parts.dayTracked
    ? "not_tracked"
    : nextDueDate == null
      ? "needs_baseline"
      : timeStatus(remainingDays, parts.rule.alertDays);

  return {
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    chassisNo: vehicle.chassisNo,
    condition: vehicle.condition,
    vehicleTypeKey: vehicle.vehicleTypeKey,
    zoneName: vehicle.zoneName,
    driverName: vehicle.driverName,
    currentKm,
    programKey: parts.programKey,
    programLabel: parts.label,
    lastServiceKm,
    lastServiceDate,
    nextDueKm,
    remainingKm,
    daysSinceService,
    nextDueDate,
    remainingDays,
    nextKmOverridden: overrideKm != null,
    nextDateOverridden: overrideDate != null,
    kmInterval: parts.rule.kmInterval,
    dayInterval: parts.rule.dayInterval,
    status: worstStatus([byKm, byTime]),
    byKm,
    byTime,
    needsSetup: byKm === "needs_baseline" || byTime === "needs_baseline",
    // A hand-set point is not a reading — it does not need an odometer to be
    // judged, so only a derived kilometre point can ask for one.
    needsOdometer: parts.kmTracked && nextDueKm != null && currentKm == null,
    odometerUpdatedAt: vehicle.odometerUpdatedAt ?? null,
    provisional: parts.rule.provisional,
    ruleScope: parts.rule.scope,
    todayMeters: parts.todayMeters,
  };
}

export type MaintenanceProgramCounts = Record<MaintenanceStatus, number> & {
  total: number;
  /** Rows where a tracked dimension still has no record to count from. */
  needsSetup: number;
  /** Rows where the kilometres decide but the vehicle has no reading stored. */
  needsOdometer: number;
  /** Distinct vehicles behind the rows. */
  vehicles: number;
  /** True while any row is still judged by unapproved fleet defaults. */
  provisional: boolean;
};

export function programCounts(rows: readonly MaintenanceProgramRow[]): MaintenanceProgramCounts {
  const counts: MaintenanceProgramCounts = {
    total: rows.length,
    normal: 0,
    due_soon: 0,
    due: 0,
    overdue: 0,
    needs_baseline: 0,
    no_rule: 0,
    not_tracked: 0,
    unknown: 0,
    needsSetup: 0,
    needsOdometer: 0,
    vehicles: 0,
    provisional: false,
  };
  const vehicles = new Set<string>();
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.needsSetup) counts.needsSetup += 1;
    if (row.needsOdometer) counts.needsOdometer += 1;
    if (row.provisional) counts.provisional = true;
    vehicles.add(row.vehicleId);
  }
  counts.vehicles = vehicles.size;
  return counts;
}

/** Rows that need an operator before they can count anything. */
export function needsSetupRows(
  rows: readonly MaintenanceProgramRow[],
): MaintenanceProgramRow[] {
  return rows.filter((row) => row.needsSetup && row.status !== "not_tracked");
}

/**
 * Rows the approved rules do not cover at all. These need an **interval rule**,
 * not a last-service date, so they are listed apart from the baseline worklist —
 * mixing them would tell the operator to enter a service for a program that has
 * no interval to compare it against.
 */
export function noRuleRows(rows: readonly MaintenanceProgramRow[]): MaintenanceProgramRow[] {
  return rows.filter((row) => row.status === "no_rule");
}

/** Rows the fleet team opted out of. Listed so the decision stays reversible. */
export function notTrackedRows(rows: readonly MaintenanceProgramRow[]): MaintenanceProgramRow[] {
  return rows.filter((row) => row.status === "not_tracked");
}

/** Rows whose kilometres decide but the vehicle's reading is missing or stale. */
export function needsOdometerRows(
  rows: readonly MaintenanceProgramRow[],
  today: string,
  staleAfterDays = 7,
): MaintenanceProgramRow[] {
  return rows.filter((row) => row.needsOdometer || isStaleOdometer(row, today, staleAfterDays));
}

/**
 * A reading older than a week. The rider app will capture a shift-out figure, but
 * until that build reaches the fleet the admin **Update Odometer** dialog is the
 * correction path — so a stale figure is surfaced here rather than trusted.
 */
export function isStaleOdometer(
  row: Pick<MaintenanceProgramRow, "kmInterval" | "currentKm" | "odometerUpdatedAt">,
  today: string,
  staleAfterDays = 7,
): boolean {
  if (row.kmInterval <= 0 || row.currentKm == null) return false;
  const day = (row.odometerUpdatedAt ?? "").slice(0, 10);
  if (!day) return false;
  const age = daysBetween(day, today);
  return age != null && age > staleAfterDays;
}

/** One entry per vehicle with its programs nested — what the grouped table draws. */
export function groupRowsByVehicle(
  rows: readonly MaintenanceProgramRow[],
): { vehicleId: string; plate: string; rows: MaintenanceProgramRow[] }[] {
  const map = new Map<
    string,
    { vehicleId: string; plate: string; rows: MaintenanceProgramRow[] }
  >();
  for (const row of rows) {
    const existing = map.get(row.vehicleId);
    if (existing) existing.rows.push(row);
    else map.set(row.vehicleId, { vehicleId: row.vehicleId, plate: row.plate, rows: [row] });
  }
  return [...map.values()];
}


/**
 * The latest **Done** record for the vehicle. `new`, `running` and `cancelled`
 * rows never reach this function — the caller filters on `stage`, and this is
 * the one place a baseline kilometre or date can come from.
 */
export function baselineFor(
  records: readonly MaintenanceDoneRecord[],
  vehicleId: string,
  serviceTypeKey: string | null,
): MaintenanceDoneRecord | null {
  let best: MaintenanceDoneRecord | null = null;
  for (const record of records) {
    if (record.vehicleId !== vehicleId) continue;
    if (serviceTypeKey && record.serviceTypeKey !== serviceTypeKey) continue;
    if (!best || record.doneDay > best.doneDay) best = record;
  }
  return best;
}

/**
 * The absolute bike figure for a day.
 *
 * The rider's own reading wins, the GPS ledger is the fallback, and the last
 * stored odometer is the floor. GPS distance is **not** an odometer — it
 * under-reads indoors and in tunnels, over-reads on scatter, and drifts from the
 * meter every month — which is why the two are kept apart instead of added.
 */
export function resolvedBikeOdometer(
  distance: VehicleDayDistance | null,
  storedKm: number | null,
): { km: number | null; source: "rider" | "gps_ledger" | "stored" | "none" } {
  if (distance?.odometerKm != null) return { km: distance.odometerKm, source: "rider" };
  if (distance && distance.totalMeters > 0 && storedKm != null) {
    return {
      km: Math.round((storedKm + distance.totalMeters / 1000) * 10) / 10,
      source: "gps_ledger",
    };
  }
  if (storedKm != null) return { km: storedKm, source: "stored" };
  return { km: null, source: "none" };
}

