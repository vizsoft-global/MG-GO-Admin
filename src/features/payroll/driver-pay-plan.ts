/**
 * Driver Pay plan. One pure function so the admin preview and the rider
 * calculator cannot disagree. Bands pay only the orders inside the band.
 * Anything under `threshold` is the low base and earns no band.
 * Deductions never take the month below `floorKwd`.
 */

export type PayVehicle = "bike" | "car";

export type PayBand = {
  from: number;
  to: number | null;
  rate: number;
};

export type DriverPayPlan = {
  baseKwd: number;
  lowBaseKwd: number;
  threshold: number;
  floorKwd: number;
  bands: PayBand[];
  penaltyBike: number;
  penaltyCar: number;
  /** 1 day, 2 days, 3 or more. */
  invalidLadder: [number, number, number];
};

export type PayInput = {
  orders: number;
  vehicle: PayVehicle;
  rejected: number;
  cancelled: number;
  invalidDays: number;
};

export type PayBandLine = {
  from: number;
  to: number | null;
  rate: number;
  orders: number;
  amount: number;
};

export type PayWarning = "low_performance" | "termination_next_month" | "floor";

export type PayBreakdown = {
  lowPerformance: boolean;
  base: number;
  bands: PayBandLine[];
  gross: number;
  orderPenalty: number;
  invalidPenalty: number;
  penaltyRequested: number;
  penaltyTaken: number;
  penaltyNotTaken: number;
  finalPay: number;
  warnings: PayWarning[];
  ordersToNext: number | null;
  nextBandFrom: number | null;
};

export const DEFAULT_DRIVER_PAY_PLAN: DriverPayPlan = {
  baseKwd: 120,
  lowBaseKwd: 90,
  threshold: 300,
  floorKwd: 90,
  bands: [
    { from: 301, to: 400, rate: 0.26 },
    { from: 401, to: 500, rate: 0.35 },
    { from: 501, to: 600, rate: 0.4 },
    { from: 601, to: null, rate: 0.45 },
  ],
  penaltyBike: 2,
  penaltyCar: 3,
  invalidLadder: [7, 21, 120],
};

export function money3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function ordersInBand(orders: number, from: number, to: number | null): number {
  if (!Number.isFinite(orders) || orders < from) return 0;
  const end = to == null ? orders : Math.min(orders, to);
  return Math.max(0, Math.trunc(end) - (from - 1));
}

function whole(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function invalidDayPenalty(days: number, ladder: readonly [number, number, number]): number {
  const count = whole(days);
  if (count <= 0) return 0;
  if (count === 1) return ladder[0];
  if (count === 2) return ladder[1];
  return ladder[2];
}

export function computeDriverPay(plan: DriverPayPlan, input: PayInput): PayBreakdown {
  const orders = whole(input.orders);
  const lowPerformance = orders < plan.threshold;
  const base = lowPerformance ? plan.lowBaseKwd : plan.baseKwd;
  const bands: PayBandLine[] = plan.bands.map((band) => {
    const count = lowPerformance ? 0 : ordersInBand(orders, band.from, band.to);
    return {
      from: band.from,
      to: band.to,
      rate: band.rate,
      orders: count,
      amount: money3(count * band.rate),
    };
  });
  const gross = money3(base + bands.reduce((sum, band) => sum + band.amount, 0));
  const perOrder = input.vehicle === "car" ? plan.penaltyCar : plan.penaltyBike;
  const orderPenalty = money3((whole(input.rejected) + whole(input.cancelled)) * perOrder);
  const invalidPenalty = money3(invalidDayPenalty(input.invalidDays, plan.invalidLadder));
  const penaltyRequested = money3(orderPenalty + invalidPenalty);
  const uncapped = money3(gross - penaltyRequested);
  const finalPay = money3(Math.max(plan.floorKwd, uncapped));
  const penaltyTaken = money3(Math.max(0, gross - finalPay));
  const penaltyNotTaken = money3(Math.max(0, penaltyRequested - penaltyTaken));

  const warnings: PayWarning[] = [];
  if (lowPerformance) warnings.push("low_performance");
  if (lowPerformance && whole(input.invalidDays) > 0) warnings.push("termination_next_month");
  if (penaltyNotTaken > 0) warnings.push("floor");

  const next = plan.bands.find((band) => orders < band.from);
  return {
    lowPerformance,
    base,
    bands,
    gross,
    orderPenalty,
    invalidPenalty,
    penaltyRequested,
    penaltyTaken,
    penaltyNotTaken,
    finalPay,
    warnings,
    ordersToNext: next ? next.from - orders : null,
    nextBandFrom: next ? next.from : null,
  };
}

export type PayPlanIssue = "overlap" | "gap" | "threshold" | "open_end" | "rate" | "ladder";

/** Bands must start the order after the threshold, touch, and leave only the last open. */
export function validatePayPlan(plan: DriverPayPlan): PayPlanIssue | null {
  if (plan.bands.length === 0) return "threshold";
  const bands = [...plan.bands].sort((a, b) => a.from - b.from);
  if (bands[0]?.from !== plan.threshold + 1) return "threshold";
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    if (!band || band.rate < 0 || !Number.isFinite(band.rate)) return "rate";
    if (i === bands.length - 1) {
      if (band.to !== null) return "open_end";
      continue;
    }
    if (band.to == null || band.to < band.from) return "overlap";
    const next = bands[i + 1];
    if (!next) return "gap";
    if (next.from <= band.to) return "overlap";
    if (next.from !== band.to + 1) return "gap";
  }
  if (plan.invalidLadder.some((step) => step < 0 || !Number.isFinite(step))) return "ladder";
  return null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Open band is null. A numeric end, including 0, stays a number. */
function bandTo(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

export function parseDriverPayPlan(raw: unknown): DriverPayPlan {
  if (!raw || typeof raw !== "object") return DEFAULT_DRIVER_PAY_PLAN;
  const row = raw as Record<string, unknown>;
  const fallback = DEFAULT_DRIVER_PAY_PLAN;
  const bandsRaw = Array.isArray(row.bands) ? row.bands : fallback.bands;
  const bands: PayBand[] = bandsRaw.map((item, index) => {
    const band = (item ?? {}) as Record<string, unknown>;
    const seed = fallback.bands[index] ?? fallback.bands[fallback.bands.length - 1];
    return {
      from: num(band.from, seed?.from ?? fallback.threshold + 1),
      to: bandTo(band.to, seed?.to ?? null),
      rate: num(band.rate, seed?.rate ?? 0),
    };
  });
  const ladderRaw = Array.isArray(row.invalid_ladder) ? row.invalid_ladder : row.invalidLadder;
  const ladder = Array.isArray(ladderRaw) ? ladderRaw : fallback.invalidLadder;
  const plan: DriverPayPlan = {
    baseKwd: num(row.base_kwd ?? row.baseKwd, fallback.baseKwd),
    lowBaseKwd: num(row.low_base_kwd ?? row.lowBaseKwd, fallback.lowBaseKwd),
    threshold: num(row.threshold, fallback.threshold),
    floorKwd: num(row.floor_kwd ?? row.floorKwd, fallback.floorKwd),
    bands: bands.length > 0 ? bands : fallback.bands,
    penaltyBike: num(row.penalty_bike ?? row.penaltyBike, fallback.penaltyBike),
    penaltyCar: num(row.penalty_car ?? row.penaltyCar, fallback.penaltyCar),
    invalidLadder: [
      num(ladder[0], fallback.invalidLadder[0]),
      num(ladder[1], fallback.invalidLadder[1]),
      num(ladder[2], fallback.invalidLadder[2]),
    ],
  };
  return validatePayPlan(plan) ? fallback : plan;
}

export function payPlanToFirestore(plan: DriverPayPlan): Record<string, unknown> {
  return {
    base_kwd: plan.baseKwd,
    low_base_kwd: plan.lowBaseKwd,
    threshold: plan.threshold,
    floor_kwd: plan.floorKwd,
    bands: plan.bands.map((band) => ({ from: band.from, to: band.to, rate: band.rate })),
    penalty_bike: plan.penaltyBike,
    penalty_car: plan.penaltyCar,
    invalid_ladder: plan.invalidLadder,
  };
}
