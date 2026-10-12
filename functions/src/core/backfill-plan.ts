import { COLLECTIONS } from "./collections";
import {
  DELIVERY_PREFIX_FIELDS,
  DRIVER_PREFIX_FIELDS,
  REQUEST_PREFIX_FIELDS,
  stampStoredRow,
  type SearchEntity,
} from "./search-text";

export const BACKFILL_BATCH = 400;
export const FIXTURE_SOURCE = "synthetic" as const;

const STATUS_KEYS = ["verified", "pending", "in_transit", "under_review", "rejected", "cancelled"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

const SEARCH_ENTITY: Record<string, SearchEntity> = {
  [COLLECTIONS.drivers]: "drivers",
  [COLLECTIONS.driverIntakes]: "driver_intakes",
  [COLLECTIONS.requests]: "requests",
  [COLLECTIONS.restaurants]: "restaurants",
  [COLLECTIONS.deliveryRules]: "delivery_rules",
  [COLLECTIONS.incentiveRules]: "incentive_rules",
  [COLLECTIONS.deliveries]: "deliveries",
};

export type StoredDoc = {
  collection: string;
  id: string;
  data: Record<string, unknown>;
};

export type SearchWrite = {
  collection: string;
  id: string;
  set: Record<string, string>;
};

export type DeliveryFact = {
  id: string;
  driverId: string;
  zoneId: string | null;
  day: string;
  status: string;
};

export type AttendanceFact = {
  id: string;
  driverId: string;
  zoneId: string | null;
  day: string;
  present: boolean;
};

export type PlannedDoc = {
  id: string;
  data: Record<string, unknown>;
};

export type ComparisonReport = {
  source: typeof FIXTURE_SOURCE | "production";
  mismatches: number;
  driverDays: number;
  zoneMonths: number;
};

const DAY_COUNT_FIELDS = [
  "verified",
  "pending",
  "in_transit",
  "under_review",
  "rejected",
  "cancelled",
  "orders",
  "attendance_present",
] as const;

const ZONE_COUNT_FIELDS = [...DAY_COUNT_FIELDS, "verified_driver_days", "attendance_days"] as const;

function isStatus(value: string): value is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(value);
}

export function planSearchWrites(docs: readonly StoredDoc[]): SearchWrite[] {
  const writes: SearchWrite[] = [];
  for (const doc of docs) {
    const entity = SEARCH_ENTITY[doc.collection];
    if (!entity) continue;
    const set = stampStoredRow(entity, doc.data);
    if (Object.keys(set).length === 0) continue;
    writes.push({ collection: doc.collection, id: doc.id, set });
  }
  return writes;
}

export function searchWriteUsesPrefixFields(write: SearchWrite): boolean {
  const keys = Object.keys(write.set);
  if (write.collection === COLLECTIONS.drivers || write.collection === COLLECTIONS.driverIntakes) {
    return keys.every((key) => (DRIVER_PREFIX_FIELDS as readonly string[]).includes(key) || key === "phone_digits");
  }
  if (write.collection === COLLECTIONS.requests) {
    return keys.every((key) => (REQUEST_PREFIX_FIELDS as readonly string[]).includes(key));
  }
  if (write.collection === COLLECTIONS.deliveries) {
    return keys.every((key) => (DELIVERY_PREFIX_FIELDS as readonly string[]).includes(key));
  }
  return keys.every((key) => key === "name_lower" || key === "merchant_id_lower" || key === "search_name");
}

type DayBucket = {
  driverId: string;
  zoneId: string | null;
  day: string;
  verified: number;
  pending: number;
  in_transit: number;
  under_review: number;
  rejected: number;
  cancelled: number;
  attendance_present: number;
};

function blankDay(driverId: string, zoneId: string | null, day: string): DayBucket {
  return {
    driverId,
    zoneId,
    day,
    verified: 0,
    pending: 0,
    in_transit: 0,
    under_review: 0,
    rejected: 0,
    cancelled: 0,
    attendance_present: 0,
  };
}

function dayKey(driverId: string, day: string): string {
  return `${driverId}_${day}`;
}

export function planRollupDocuments(
  deliveries: readonly DeliveryFact[],
  attendance: readonly AttendanceFact[],
): { driverDays: PlannedDoc[]; zoneMonths: PlannedDoc[] } {
  const days = new Map<string, DayBucket>();
  for (const row of deliveries) {
    if (!isStatus(row.status)) continue;
    const id = dayKey(row.driverId, row.day);
    const bucket = days.get(id) ?? blankDay(row.driverId, row.zoneId, row.day);
    bucket[row.status] += 1;
    if (bucket.zoneId === null) bucket.zoneId = row.zoneId;
    days.set(id, bucket);
  }
  for (const row of attendance) {
    if (!row.present) continue;
    const id = dayKey(row.driverId, row.day);
    const bucket = days.get(id) ?? blankDay(row.driverId, row.zoneId, row.day);
    bucket.attendance_present += 1;
    if (bucket.zoneId === null) bucket.zoneId = row.zoneId;
    days.set(id, bucket);
  }

  const driverDays: PlannedDoc[] = [...days.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([id, bucket]) => ({
      id,
      data: {
        driver_id: bucket.driverId,
        day: bucket.day,
        month: bucket.day.slice(0, 7),
        zone_id: bucket.zoneId,
        partial: false,
        verified: bucket.verified,
        pending: bucket.pending,
        in_transit: bucket.in_transit,
        under_review: bucket.under_review,
        rejected: bucket.rejected,
        cancelled: bucket.cancelled,
        orders: bucket.verified,
        attendance_present: bucket.attendance_present,
      },
    }));

  type ZoneBucket = {
    zoneId: string;
    month: string;
    verified: number;
    pending: number;
    in_transit: number;
    under_review: number;
    rejected: number;
    cancelled: number;
    orders: number;
    verified_driver_days: number;
    attendance_days: number;
  };
  const zones = new Map<string, ZoneBucket>();
  for (const bucket of days.values()) {
    if (!bucket.zoneId) continue;
    const month = bucket.day.slice(0, 7);
    const id = `${bucket.zoneId}_${month}`;
    const zone = zones.get(id) ?? {
      zoneId: bucket.zoneId,
      month,
      verified: 0,
      pending: 0,
      in_transit: 0,
      under_review: 0,
      rejected: 0,
      cancelled: 0,
      orders: 0,
      verified_driver_days: 0,
      attendance_days: 0,
    };
    for (const status of STATUS_KEYS) zone[status] += bucket[status];
    zone.orders += bucket.verified;
    if (bucket.verified > 0) zone.verified_driver_days += 1;
    if (bucket.attendance_present > 0) zone.attendance_days += 1;
    zones.set(id, zone);
  }

  const zoneMonths: PlannedDoc[] = [...zones.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([id, zone]) => ({
      id,
      data: {
        zone_id: zone.zoneId,
        month: zone.month,
        partial: false,
        verified: zone.verified,
        pending: zone.pending,
        in_transit: zone.in_transit,
        under_review: zone.under_review,
        rejected: zone.rejected,
        cancelled: zone.cancelled,
        orders: zone.orders,
        verified_driver_days: zone.verified_driver_days,
        attendance_days: zone.attendance_days,
      },
    }));

  return { driverDays, zoneMonths };
}

export function numericFields(data: Record<string, unknown>, fields: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of fields) {
    const value = data[field];
    out[field] = typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  return out;
}

export function driverDayNumbers(data: Record<string, unknown>): Record<string, number> {
  return numericFields(data, DAY_COUNT_FIELDS);
}

export function zoneMonthNumbers(data: Record<string, unknown>): Record<string, number> {
  return numericFields(data, ZONE_COUNT_FIELDS);
}

export function mismatchCount(
  expected: ReadonlyMap<string, Record<string, number>>,
  actual: ReadonlyMap<string, Record<string, number>>,
): number {
  const ids = new Set<string>([...expected.keys(), ...actual.keys()]);
  let mismatches = 0;
  for (const id of ids) {
    const left = expected.get(id);
    const right = actual.get(id);
    if (!left || !right) {
      mismatches += 1;
      continue;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (left[key] !== right[key]) mismatches += 1;
    }
  }
  return mismatches;
}

export function applyGuard(options: {
  apply: boolean;
  confirm: string | undefined;
  report: ComparisonReport | null;
}): { ok: true } | { ok: false; code: number; reason: string } {
  if (!options.apply) return { ok: true };
  if (options.confirm !== "yes") return { ok: false, code: 2, reason: "confirm_required" };
  if (!options.report) return { ok: false, code: 2, reason: "comparison_required" };
  if (options.report.mismatches !== 0) return { ok: false, code: 1, reason: "comparison_mismatch" };
  return { ok: true };
}

export function formatDryRunCounts(input: {
  source: "none" | typeof FIXTURE_SOURCE;
  searchWrites: number;
  driverDaySets: number;
  zoneMonthSets: number;
  byCollection: Record<string, number>;
}): string {
  const lines = [
    "dry_run=true",
    `source=${input.source}`,
    `search_writes=${input.searchWrites}`,
    `driver_day_sets=${input.driverDaySets}`,
    `zone_month_sets=${input.zoneMonthSets}`,
    "writes=0",
  ];
  for (const collection of Object.keys(input.byCollection).sort()) {
    lines.push(`collection=${collection} count=${input.byCollection[collection]}`);
  }
  return lines.join("\n");
}

export function resumeSlice<T extends { id: string }>(
  rows: readonly T[],
  afterId: string | null,
): { batch: T[]; checkpoint: string | null } {
  const sorted = [...rows].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const start = afterId === null ? 0 : sorted.findIndex((row) => row.id === afterId) + 1;
  const from = start < 0 ? sorted.length : start;
  const batch = sorted.slice(from, from + BACKFILL_BATCH);
  if (batch.length === 0) return { batch, checkpoint: null };
  if (from + batch.length >= sorted.length) return { batch, checkpoint: null };
  return { batch, checkpoint: batch[batch.length - 1]?.id ?? null };
}

export const SYNTHETIC_SAMPLE_DAYS = [
  { day: "2026-01-05", kind: "busy" },
  { day: "2026-01-06", kind: "quiet" },
  { day: "2026-01-12", kind: "cancellations" },
  { day: "2026-01-13", kind: "rejections" },
  { day: "2026-01-31", kind: "month_boundary" },
  { day: "2026-02-01", kind: "month_boundary" },
  { day: "2026-02-14", kind: "mixed" },
] as const;

const DRIVERS = {
  a: { id: "drv-a", zoneId: "zone-a" },
  b: { id: "drv-b", zoneId: "zone-a" },
  c: { id: "drv-c", zoneId: "zone-b" },
} as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthDays(year: number, month: number): string[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) days.push(`${year}-${pad(month)}-${pad(day)}`);
  return days;
}

function pushDelivery(
  deliveries: DeliveryFact[],
  driver: { id: string; zoneId: string },
  day: string,
  status: StatusKey,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    deliveries.push({
      id: `del-${day}-${driver.id}-${status}-${index}`,
      driverId: driver.id,
      zoneId: driver.zoneId,
      day,
      status,
    });
  }
}

function pushPresent(attendance: AttendanceFact[], driver: { id: string; zoneId: string }, day: string): void {
  attendance.push({
    id: `att-${day}-${driver.id}`,
    driverId: driver.id,
    zoneId: driver.zoneId,
    day,
    present: true,
  });
}

function specialDay(day: string, kind: (typeof SYNTHETIC_SAMPLE_DAYS)[number]["kind"], deliveries: DeliveryFact[], attendance: AttendanceFact[]): void {
  if (kind === "busy") {
    pushDelivery(deliveries, DRIVERS.a, day, "verified", 8);
    pushDelivery(deliveries, DRIVERS.a, day, "pending", 3);
    pushDelivery(deliveries, DRIVERS.a, day, "in_transit", 2);
    pushDelivery(deliveries, DRIVERS.b, day, "verified", 5);
    pushDelivery(deliveries, DRIVERS.c, day, "verified", 1);
    pushPresent(attendance, DRIVERS.a, day);
    pushPresent(attendance, DRIVERS.b, day);
    pushPresent(attendance, DRIVERS.c, day);
    return;
  }
  if (kind === "quiet") {
    pushDelivery(deliveries, DRIVERS.a, day, "verified", 1);
    pushPresent(attendance, DRIVERS.a, day);
    attendance.push({
      id: `att-${day}-${DRIVERS.b.id}-absent`,
      driverId: DRIVERS.b.id,
      zoneId: DRIVERS.b.zoneId,
      day,
      present: false,
    });
    return;
  }
  if (kind === "cancellations") {
    pushDelivery(deliveries, DRIVERS.a, day, "cancelled", 6);
    pushDelivery(deliveries, DRIVERS.c, day, "cancelled", 1);
    pushDelivery(deliveries, DRIVERS.b, day, "verified", 1);
    pushPresent(attendance, DRIVERS.b, day);
    return;
  }
  if (kind === "rejections") {
    pushDelivery(deliveries, DRIVERS.b, day, "rejected", 4);
    pushDelivery(deliveries, DRIVERS.a, day, "rejected", 1);
    pushDelivery(deliveries, DRIVERS.c, day, "under_review", 2);
    return;
  }
  if (kind === "month_boundary" && day.endsWith("-31")) {
    pushDelivery(deliveries, DRIVERS.a, day, "verified", 2);
    pushDelivery(deliveries, DRIVERS.b, day, "cancelled", 3);
    pushPresent(attendance, DRIVERS.a, day);
    return;
  }
  if (kind === "month_boundary") {
    pushDelivery(deliveries, DRIVERS.a, day, "verified", 4);
    pushDelivery(deliveries, DRIVERS.b, day, "rejected", 2);
    pushPresent(attendance, DRIVERS.a, day);
    return;
  }
  pushDelivery(deliveries, DRIVERS.a, day, "under_review", 2);
  pushDelivery(deliveries, DRIVERS.a, day, "in_transit", 1);
  pushDelivery(deliveries, DRIVERS.a, day, "pending", 1);
  pushDelivery(deliveries, DRIVERS.a, day, "cancelled", 1);
  pushDelivery(deliveries, DRIVERS.a, day, "rejected", 1);
  pushDelivery(deliveries, DRIVERS.a, day, "verified", 1);
  pushPresent(attendance, DRIVERS.a, day);
}

export function syntheticComparisonFixture(): {
  source: typeof FIXTURE_SOURCE;
  deliveries: DeliveryFact[];
  attendance: AttendanceFact[];
  searchDocs: StoredDoc[];
} {
  const special = new Map<string, (typeof SYNTHETIC_SAMPLE_DAYS)[number]["kind"]>(
    SYNTHETIC_SAMPLE_DAYS.map((row) => [row.day, row.kind]),
  );
  const deliveries: DeliveryFact[] = [];
  const attendance: AttendanceFact[] = [];
  for (const day of [...monthDays(2026, 1), ...monthDays(2026, 2)]) {
    const kind = special.get(day);
    if (kind) {
      specialDay(day, kind, deliveries, attendance);
      continue;
    }
    pushDelivery(deliveries, DRIVERS.a, day, "verified", 1);
    pushPresent(attendance, DRIVERS.a, day);
  }
  const searchDocs: StoredDoc[] = [
    {
      collection: COLLECTIONS.drivers,
      id: DRIVERS.a.id,
      data: {
        full_name: "Jenson Doe",
        driver_code: "10088",
        employee_id: "108899",
        phone: "+965 5000 0000",
        client_id: "CL-9",
        client_name: "Acme",
        zone_name: "Hawally",
        partner_name: "Talabat",
        company_name: "MG",
      },
    },
    {
      collection: COLLECTIONS.driverIntakes,
      id: "intake-a",
      data: { full_name: "Jenson Doe", driver_code: "10088", employee_id: "108899" },
    },
    {
      collection: COLLECTIONS.requests,
      id: "req-1",
      data: {
        request_code: "RCM-0074",
        driver_name: "Jenson Doe",
        driver_code: "10088",
        employee_id: "108899",
      },
    },
    {
      collection: COLLECTIONS.restaurants,
      id: "rest-1",
      data: { name: "KFC Hawally", external_merchant_id: "100" },
    },
    {
      collection: COLLECTIONS.deliveryRules,
      id: "rule-1",
      data: { name: "DPD 5" },
    },
    {
      collection: COLLECTIONS.incentiveRules,
      id: "inc-1",
      data: { name: "Weekend Boost" },
    },
    {
      collection: COLLECTIONS.deliveries,
      id: deliveries[0]?.id ?? "del-sample",
      data: {
        external_order_id: "ORD-42",
        driver_name: "Jenson Doe",
        driver_code: "10088",
        employee_id: "108899",
      },
    },
  ];
  return { source: FIXTURE_SOURCE, deliveries, attendance, searchDocs };
}
