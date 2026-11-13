/**
 * Usage monitor maths. Pure, so the forecast on screen is the forecast under test.
 *
 * The page answers one question: "if the last N hours are what a normal hour looks
 * like, what does a month cost?" — asked for 1h, 5h and 24h, because a spike shows
 * in the short window long before it moves the long one.
 */

export type UsagePoint = {
  /** Bucket end, epoch milliseconds. */
  t: number;
  v: number;
};

export const USAGE_WINDOWS = [
  { key: "h1", hours: 1 },
  { key: "h5", hours: 5 },
  { key: "h24", hours: 24 },
] as const;

export type UsageWindowKey = (typeof USAGE_WINDOWS)[number]["key"];

export type WindowTotals = Record<UsageWindowKey, number>;

const HOUR_MS = 3_600_000;
const DAYS_PER_MONTH = 30;

/** Sum of the buckets that ended inside the last `hours` before `endMs`. */
export function windowTotal(points: readonly UsagePoint[], endMs: number, hours: number): number {
  const from = endMs - hours * HOUR_MS;
  let sum = 0;
  for (const point of points) {
    if (point.t > from && point.t <= endMs) sum += point.v;
  }
  return sum;
}

export function windowTotals(points: readonly UsagePoint[], endMs: number): WindowTotals {
  return {
    h1: windowTotal(points, endMs, 1),
    h5: windowTotal(points, endMs, 5),
    h24: windowTotal(points, endMs, 24),
  };
}

/** A window's total, stretched to a day at the same rate. */
export function perDayAtRate(total: number, hours: number): number {
  if (!(hours > 0)) return 0;
  return (total / hours) * 24;
}

/**
 * Prices are assumptions, not facts read from the bill: Google publishes them per
 * region and edition, and this project's database is Enterprise edition, whose
 * unit prices differ from Standard. The page lets an operator overwrite every one.
 * Defaults are the Standard-edition list prices for a multi-region database, which
 * is the expensive end of the range.
 */
export type UsageRates = {
  readsPer100k: number;
  writesPer100k: number;
  deletesPer100k: number;
  freeReadsPerDay: number;
  freeWritesPerDay: number;
  freeDeletesPerDay: number;
  invocationsPerMillion: number;
  freeInvocationsPerMonth: number;
  vcpuSecond: number;
  gibSecond: number;
  freeVcpuSecondsPerMonth: number;
  freeGibSecondsPerMonth: number;
};

export const DEFAULT_USAGE_RATES: UsageRates = {
  readsPer100k: 0.06,
  writesPer100k: 0.18,
  deletesPer100k: 0.02,
  freeReadsPerDay: 50_000,
  freeWritesPerDay: 20_000,
  freeDeletesPerDay: 20_000,
  invocationsPerMillion: 0.4,
  freeInvocationsPerMonth: 2_000_000,
  vcpuSecond: 0.000024,
  gibSecond: 0.0000025,
  freeVcpuSecondsPerMonth: 180_000,
  freeGibSecondsPerMonth: 360_000,
};

export const USAGE_RATE_KEYS = Object.keys(DEFAULT_USAGE_RATES) as Array<keyof UsageRates>;

/** Keeps a stored or typed rate set usable: unknown keys dropped, bad numbers reset. */
export function sanitizeRates(input: unknown): UsageRates {
  const out: UsageRates = { ...DEFAULT_USAGE_RATES };
  if (!input || typeof input !== "object") return out;
  const source = input as Record<string, unknown>;
  for (const key of USAGE_RATE_KEYS) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export type WindowUsage = {
  reads: number;
  writes: number;
  deletes: number;
  /** TTL deletions are billed as deletes and are not covered by the free quota. */
  ttlDeletes: number;
  invocations: number;
  vcpuSeconds: number;
  gibSeconds: number;
};

export type MonthlyForecast = {
  perDay: WindowUsage;
  reads: number;
  writes: number;
  deletes: number;
  invocations: number;
  compute: number;
  total: number;
};

function paid(units: number, free: number): number {
  return Math.max(0, units - free);
}

/**
 * Monthly cost if every hour looked like this window.
 *
 * Firestore's free quota is per day, so it is taken off the daily figure; the
 * functions free tier is per month, so it is taken off the monthly one.
 */
export function forecastMonthly(
  usage: WindowUsage,
  hours: number,
  rates: UsageRates,
): MonthlyForecast {
  const perDay: WindowUsage = {
    reads: perDayAtRate(usage.reads, hours),
    writes: perDayAtRate(usage.writes, hours),
    deletes: perDayAtRate(usage.deletes, hours),
    ttlDeletes: perDayAtRate(usage.ttlDeletes, hours),
    invocations: perDayAtRate(usage.invocations, hours),
    vcpuSeconds: perDayAtRate(usage.vcpuSeconds, hours),
    gibSeconds: perDayAtRate(usage.gibSeconds, hours),
  };

  const reads =
    (paid(perDay.reads, rates.freeReadsPerDay) / 100_000) * rates.readsPer100k * DAYS_PER_MONTH;
  const writes =
    (paid(perDay.writes, rates.freeWritesPerDay) / 100_000) * rates.writesPer100k * DAYS_PER_MONTH;
  const deletes =
    ((paid(perDay.deletes, rates.freeDeletesPerDay) + perDay.ttlDeletes) / 100_000) *
    rates.deletesPer100k *
    DAYS_PER_MONTH;
  const invocations =
    (paid(perDay.invocations * DAYS_PER_MONTH, rates.freeInvocationsPerMonth) / 1_000_000) *
    rates.invocationsPerMillion;
  const compute =
    paid(perDay.vcpuSeconds * DAYS_PER_MONTH, rates.freeVcpuSecondsPerMonth) * rates.vcpuSecond +
    paid(perDay.gibSeconds * DAYS_PER_MONTH, rates.freeGibSecondsPerMonth) * rates.gibSecond;

  return {
    perDay,
    reads,
    writes,
    deletes,
    invocations,
    compute,
    total: reads + writes + deletes + invocations + compute,
  };
}

/**
 * CPU and memory a function's instances are billed at.
 *
 * Cloud Monitoring reports billable instance seconds per service but not the
 * shape, and the shape is what turns seconds into money. These mirror the
 * deployed options: the three admin lanes, the three worker doors, and the
 * global 0.08 vCPU / 256 MiB default every other function runs on.
 */
export function functionShape(serviceName: string): { cpu: number; memGib: number } {
  switch (serviceName.toLowerCase()) {
    case "adminapi":
      return { cpu: 1, memGib: 2 };
    case "adminapiscan":
    case "adminapiheavy":
      return { cpu: 1, memGib: 4 };
    case "workerfleetread":
    case "adminingestdriverpositions":
    case "adminrecordfleetevents":
      return { cpu: 1, memGib: 0.25 };
    default:
      return { cpu: 0.08, memGib: 0.25 };
  }
}

/** Collapses fine buckets into wider ones for a chart that has to stay legible. */
export function rebucket(
  points: readonly UsagePoint[],
  endMs: number,
  bucketMs: number,
  count: number,
): UsagePoint[] {
  const out: UsagePoint[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    out.push({ t: endMs - index * bucketMs, v: 0 });
  }
  const startMs = endMs - count * bucketMs;
  for (const point of points) {
    if (point.t <= startMs || point.t > endMs) continue;
    const slot = Math.min(count - 1, Math.floor((point.t - startMs - 1) / bucketMs));
    out[slot]!.v += point.v;
  }
  return out;
}
