import type { ServiceCategoryKey } from "./service-types";
import type { MaintenanceRuleScope, MaintenanceScheduleRow } from "./types";

/**
 * The five **scheduled** programs.
 *
 * `service_types` holds 468 part rows (engine 108, brakes 44, tyres 20 …) and
 * every one of them is a *cost* line on a workshop invoice. Maintenance is a
 * different question — "when is this due again?" — and only a handful of jobs
 * are scheduled that way. These five are the layer the client approved
 * intervals for; the part rows keep costing exactly as they did.
 *
 * A row is written to `service_types` for each key here with
 * `tracks_maintenance: true`, so the catalog list and the record form can label
 * them without a second vocabulary. Nothing else participates in the
 * calculation — a record filed under `oil_filter` still costs money but never
 * moves a due date.
 */
export const SCHEDULED_PROGRAM_KEYS = [
  "oil_change",
  "tire_front",
  "tire_rear",
  "brake",
  "chain",
] as const;

export type ScheduledProgramKey = (typeof SCHEDULED_PROGRAM_KEYS)[number];

export type ScheduledProgram = {
  key: ScheduledProgramKey;
  labelEn: string;
  labelAr: string;
  category: ServiceCategoryKey;
  sortOrder: number;
  /**
   * The vehicle types this program is scheduled on. A type that is not listed
   * here never gets a maintenance row — the client does not change tyres on a
   * motorbike and does not adjust a chain on a car, so neither is guessed.
   */
  vehicleTypes: readonly string[];
};

export const SCHEDULED_PROGRAMS: readonly ScheduledProgram[] = [
  {
    key: "oil_change",
    labelEn: "Oil change",
    labelAr: "تغيير الزيت",
    category: "engine",
    sortOrder: 10,
    vehicleTypes: ["car", "bike"],
  },
  {
    key: "tire_front",
    labelEn: "Front tyres",
    labelAr: "الإطارات الأمامية",
    category: "tyres",
    sortOrder: 20,
    vehicleTypes: ["car"],
  },
  {
    key: "tire_rear",
    labelEn: "Rear tyres",
    labelAr: "الإطارات الخلفية",
    category: "tyres",
    sortOrder: 30,
    vehicleTypes: ["car"],
  },
  {
    key: "brake",
    labelEn: "Brakes",
    labelAr: "الفرامل",
    category: "brakes",
    sortOrder: 40,
    vehicleTypes: ["car", "bike"],
  },
  {
    key: "chain",
    labelEn: "Chain",
    labelAr: "السلسلة",
    category: "transmission",
    sortOrder: 50,
    vehicleTypes: ["bike"],
  },
];

export function isScheduledProgramKey(value: unknown): value is ScheduledProgramKey {
  return typeof value === "string" && (SCHEDULED_PROGRAM_KEYS as readonly string[]).includes(value);
}

/**
 * A program the maintenance tab draws. The five curated ones carry their own
 * wording and vehicle-type gating; a program the fleet team added later comes
 * from the catalog and its applicability is decided by its rules.
 */
export type MaintenanceProgram = {
  key: string;
  labelEn: string;
  labelAr: string;
  category: ServiceCategoryKey;
  sortOrder: number;
  /** `false` for a catalog program added after this module shipped. */
  curated: boolean;
};

/** The five curated programs, in the shape the data-driven list uses. */
export function curatedPrograms(): MaintenanceProgram[] {
  return SCHEDULED_PROGRAMS.map((program) => ({
    key: program.key,
    labelEn: program.labelEn,
    labelAr: program.labelAr,
    category: program.category,
    sortOrder: program.sortOrder,
    curated: true,
  }));
}

/**
 * Every program the fleet team can schedule — the curated five plus any catalog
 * row flagged `tracks_maintenance`.
 *
 * This is what makes "any additional maintenance service added in the future"
 * true without a code change: marking a service type as tracked in
 * `/settings/service-types` is the only step, and the interval rule the operator
 * writes is what decides where it applies. A catalog row that reuses a curated
 * key is folded into the curated entry so a program cannot appear twice under two
 * labels.
 */
export function maintenanceProgramsFromCatalog(
  types: readonly { key: string; label_en: string; label_ar?: string | null; category?: string | null; sort_order?: number; tracks_maintenance?: boolean }[],
): MaintenanceProgram[] {
  const byKey = new Map<string, MaintenanceProgram>();
  for (const program of curatedPrograms()) byKey.set(program.key, program);
  for (const row of types) {
    if (!row.tracks_maintenance) continue;
    const key = row.key.trim();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      labelEn: row.label_en || key,
      labelAr: row.label_ar || "",
      category: (row.category as ServiceCategoryKey) ?? "other",
      sortOrder: row.sort_order ?? 100,
      curated: false,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn),
  );
}

/** The curated gating, when the program has one. A catalog program has none. */
export function curatedVehicleTypes(programKey: string): readonly string[] | null {
  const program = scheduledProgram(programKey);
  return program ? program.vehicleTypes : null;
}


export function scheduledProgram(key: string | null | undefined): ScheduledProgram | null {
  if (!isScheduledProgramKey(key)) return null;
  return SCHEDULED_PROGRAMS.find((program) => program.key === key) ?? null;
}

export function programLabel(key: string | null | undefined, locale: string): string {
  const program = scheduledProgram(key);
  if (!program) return key ?? "";
  return locale === "ar" ? program.labelAr || program.labelEn : program.labelEn;
}

/** The vehicle type a program list is keyed on, or null when it is not a fleet type. */
export function vehicleTypeForPrograms(vehicleTypeKey: string | null | undefined): string | null {
  const key = (vehicleTypeKey ?? "").trim().toLowerCase();
  return key === "car" || key === "bike" ? key : null;
}

export function programApplies(
  programKey: string,
  vehicleTypeKey: string | null | undefined,
): boolean {
  const type = vehicleTypeForPrograms(vehicleTypeKey);
  if (!type) return false;
  const program = scheduledProgram(programKey);
  // A curated program carries its own gating — the client does not change tyres on
  // a motorbike. A program the fleet team added later has no curated gating at
  // all, so the interval rule is what decides where it applies.
  return program ? program.vehicleTypes.includes(type) : true;
}

/** The programs scheduled on one vehicle type, in display order. */
export function programsForVehicleType(
  vehicleTypeKey: string | null | undefined,
): ScheduledProgram[] {
  return SCHEDULED_PROGRAMS.filter((program) => programApplies(program.key, vehicleTypeKey));
}
/**
 * The client's approved alert window. **500 km or 5 days, whichever is reached
 * first** — it replaces the provisional 500 / 14 that shipped before approval.
 */
export const PROGRAM_ALERT_KM = 500;
export const PROGRAM_ALERT_DAYS = 5;


/**
 * A seedable interval rule. `id` is deterministic so seeding twice is an
 * upsert, never a second row.
 */
export type ApprovedProgramRule = {
  id: string;
  programKey: ScheduledProgramKey;
  scope: MaintenanceRuleScope;
  makeKey?: string;
  makeModelKey?: string;
  vehicleTypeKey?: string;
  vehicleId?: string;
  kmInterval: number;
  dayInterval: number;
  alertKm: number;
  alertDays: number;
  note: string;
};

/**
 * The intervals exactly as the client approved them.
 *
 * `0` on a dimension is not "unknown" — it is how the rule says **not tracked
 * there**. Brakes on a bike carry no kilometre interval because a bike's
 * odometer is not a dependable figure yet, so only the 45 days decide; front
 * tyres carry no day interval because they wear by distance, not by the
 * calendar.
 */
export const APPROVED_PROGRAM_RULES: readonly ApprovedProgramRule[] = [
  {
    id: "program_oil_change_vehicle_type_bike",
    programKey: "oil_change",
    scope: "vehicle_type",
    vehicleTypeKey: "bike",
    kmInterval: 1500,
    dayInterval: 10,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Bike oil change — 1,500 km or 10 days.",
  },
  {
    id: "program_oil_change_make_toyota",
    programKey: "oil_change",
    scope: "make",
    makeKey: "toyota",
    kmInterval: 10000,
    dayInterval: 180,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Toyota oil change — 10,000 km or 180 days (Yaris, Lite Ace, Coaster).",
  },
  {
    id: "program_oil_change_make_hyundai",
    programKey: "oil_change",
    scope: "make",
    makeKey: "hyundai",
    kmInterval: 5000,
    dayInterval: 0,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Hyundai oil change — 5,000 km, no day interval (Sonata, Palisade, H1, Half Lorry).",
  },
  {
    id: "program_tire_front_vehicle_type_car",
    programKey: "tire_front",
    scope: "vehicle_type",
    vehicleTypeKey: "car",
    kmInterval: 50000,
    dayInterval: 0,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Front tyres — 50,000 km. Wear-based, so no day interval.",
  },
  {
    id: "program_tire_rear_vehicle_type_car",
    programKey: "tire_rear",
    scope: "vehicle_type",
    vehicleTypeKey: "car",
    kmInterval: 60000,
    dayInterval: 0,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Rear tyres — 60,000 km. Wear-based, so no day interval.",
  },
  {
    id: "program_brake_vehicle_type_car",
    programKey: "brake",
    scope: "vehicle_type",
    vehicleTypeKey: "car",
    kmInterval: 30000,
    dayInterval: 0,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Car brakes — 30,000 km.",
  },
  {
    id: "program_brake_vehicle_type_bike",
    programKey: "brake",
    scope: "vehicle_type",
    vehicleTypeKey: "bike",
    kmInterval: 0,
    dayInterval: 45,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Bike brakes — 45 days. No km interval while the bike odometer is not dependable.",
  },
  {
    id: "program_chain_vehicle_type_bike",
    programKey: "chain",
    scope: "vehicle_type",
    vehicleTypeKey: "bike",
    kmInterval: 0,
    dayInterval: 45,
    alertKm: PROGRAM_ALERT_KM,
    alertDays: PROGRAM_ALERT_DAYS,
    note: "Bike chain — 45 days.",
  },
];

/** The catalog rows a seed writes, so the five programs are choosable on a record. */
export function programCatalogRows(): {
  key: ScheduledProgramKey;
  label_en: string;
  label_ar: string;
  category: ServiceCategoryKey;
  sort_order: number;
}[] {
  return SCHEDULED_PROGRAMS.map((program) => ({
    key: program.key,
    label_en: program.labelEn,
    label_ar: program.labelAr,
    category: program.category,
    sort_order: program.sortOrder,
  }));
}

/**
 * The approved spec in the shape the resolver reads.
 *
 * `APPROVED_PROGRAM_RULES` is what a seed writes; `vehicle_maintenance_schedules`
 * is what the model reads. Converting in one place means a test, the seed and the
 * panel can never describe the same rule differently.
 */
export function approvedRulesAsSchedules(): MaintenanceScheduleRow[] {
  const labels = new Map(SCHEDULED_PROGRAMS.map((program) => [program.key, program.labelEn]));
  return APPROVED_PROGRAM_RULES.map((rule) => ({
    id: rule.id,
    scope: rule.scope,
    vehicle_id: rule.vehicleId ?? null,
    make_model_key: rule.makeModelKey ?? null,
    make_key: rule.makeKey ?? null,
    vehicle_type_key: rule.vehicleTypeKey ?? null,
    service_type_key: rule.programKey,
    service_type_label: labels.get(rule.programKey) ?? rule.programKey,
    km_interval: rule.kmInterval,
    day_interval: rule.dayInterval,
    alert_km: rule.alertKm,
    alert_days: rule.alertDays,
    is_active: true,
    created_at: null,
    updated_at: null,
  }));
}
