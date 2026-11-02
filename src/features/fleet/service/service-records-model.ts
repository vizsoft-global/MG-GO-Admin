import type { ServicePart, ServiceRecordRow, ServiceStage } from "./types";
import { SERVICE_STAGES } from "./types";

export function isServiceStage(value: unknown): value is ServiceStage {
  return typeof value === "string" && (SERVICE_STAGES as readonly string[]).includes(value);
}

/**
 * The stage a stored row means. A row written before this module existed has no
 * `stage` at all and is a finished workshop visit, so it reads as `done` — the
 * same thing the UI prints, and the same rule the maintenance baseline uses.
 */
export function recordStage(row: Record<string, unknown>): ServiceStage {
  return isServiceStage(row.stage) ? row.stage : "done";
}

export function isDoneRecord(row: Record<string, unknown>): boolean {
  return recordStage(row) === "done";
}

/** `done` and `cancelled` are terminal: a correction is a new record. */
export const TERMINAL_STAGES: readonly ServiceStage[] = ["done", "cancelled"];

export const STAGE_TRANSITIONS: Record<ServiceStage, readonly ServiceStage[]> = {
  new: ["running", "done", "cancelled"],
  running: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function isTerminalStage(stage: ServiceStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export function canTransitionStage(from: ServiceStage, to: ServiceStage): boolean {
  if (from === to) return false;
  return STAGE_TRANSITIONS[from].includes(to);
}

export function nextStageOptions(stage: ServiceStage): ServiceStage[] {
  return [...STAGE_TRANSITIONS[stage]];
}

/** `cancelled` needs a reason; every other move may carry an optional note. */
export function transitionRequiresNote(to: ServiceStage): boolean {
  return to === "cancelled";
}

export function odometerOf(row: Record<string, unknown>): number | null {
  const next = row.odometer_km;
  if (typeof next === "number" && Number.isFinite(next)) return next;
  const legacy = row.odometer;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : null;
}

/** Kuwait day of the record — `done_at` when it is Done, else the service date. */
export function recordDay(row: Record<string, unknown>): string {
  const done = String(row.done_at ?? "").slice(0, 10);
  if (done) return done;
  return String(row.serviced_at ?? "").slice(0, 10);
}

export function monthKeyOf(day: string): string {
  return day.slice(0, 7);
}

export function positiveNumber(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function partTotal(qty: unknown, unitCost: unknown): number {
  const q = positiveNumber(qty);
  const c = positiveNumber(unitCost);
  if (q == null || c == null) return 0;
  return Math.round(q * c * 1000) / 1000;
}

/** Drops blank lines; a part with no name or no quantity is not a part. */
export function normaliseParts(input: unknown): ServicePart[] {
  if (!Array.isArray(input)) return [];
  const parts: ServicePart[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const qty = positiveNumber(row.qty);
    const unit = positiveNumber(row.unit_cost_kwd);
    if (!name || qty == null || qty <= 0) continue;
    const cost = unit == null || unit < 0 ? 0 : unit;
    parts.push({
      name: name.slice(0, 120),
      qty,
      unit_cost_kwd: cost,
      total_kwd: partTotal(qty, cost),
    });
  }
  return parts;
}

export function partsTotal(parts: readonly ServicePart[] | null | undefined): number {
  if (!parts || parts.length === 0) return 0;
  return Math.round(parts.reduce((sum, part) => sum + part.total_kwd, 0) * 1000) / 1000;
}

/**
 * What the record cost. `cost_kwd` is the invoice figure the client types; the
 * parts grid is the same money broken down, so a record with an invoice value
 * must not be added to its own parts. A record that carries only priced parts
 * still contributes their total.
 */
export function effectiveRecordCost(row: {
  cost_kwd?: number | null;
  parts?: readonly ServicePart[] | null;
}): number {
  const invoice = positiveNumber(row.cost_kwd);
  if (invoice != null && invoice > 0) return invoice;
  return partsTotal(row.parts);
}

export type StageCounts = Record<ServiceStage | "all", number>;

export function stageCounts(
  rows: readonly Pick<ServiceRecordRow, "stage">[],
): StageCounts {
  const counts: StageCounts = { all: rows.length, new: 0, running: 0, done: 0, cancelled: 0 };
  for (const row of rows) {
    counts[recordStage(row)] += 1;
  }
  return counts;
}

/** New + Running — the KPI's "Open" figure. */
export function openCount(counts: StageCounts): number {
  return counts.new + counts.running;
}


export type OdometerDecision =
  | { action: "set"; km: number }
  | { action: "same"; km: number }
  | { action: "skip" }
  | { action: "refuse_below"; km: number; currentKm: number }
  | { action: "invalid" };

/**
 * The monotonic guard. A reading can only move the stored figure up: a typo of
 * `78 500` where the vehicle is at `185 000` must not rewind maintenance and
 * hide every overdue service behind a fresh baseline.
 */
export function odometerDecision(
  currentKm: number | null | undefined,
  reading: number | null | undefined,
): OdometerDecision {
  if (reading == null) return { action: "skip" };
  if (!Number.isFinite(reading) || reading < 0) return { action: "invalid" };
  if (currentKm == null || !Number.isFinite(currentKm)) return { action: "set", km: reading };
  if (reading > currentKm) return { action: "set", km: reading };
  if (reading === currentKm) return { action: "same", km: reading };
  return { action: "refuse_below", km: reading, currentKm };
}

export type ServiceRecordInput = {
  vehicleId: string;
  servicedAt: string;
  description: string;
  serviceTypeKey: string;
  driverId: string;
  invoiceNo: string;
  invoiceDate: string;
  company: string;
  vendor: string;
  notes: string;
  odometerKm: number | null;
  costKwd: number | null;
  parts: ServicePart[];
};

export const SERVICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Dead simple, timezone-free: the caller passes Kuwait's today. */
export function isFutureDay(day: string, today: string): boolean {
  if (!SERVICE_DATE_RE.test(day)) return false;
  return day > today;
}

export function validateServiceRecordInput(
  input: ServiceRecordInput,
  today: string,
): ValidationResult {
  if (!input.vehicleId.trim()) return { ok: false, error: "missing_vehicle" };
  if (!SERVICE_DATE_RE.test(input.servicedAt)) return { ok: false, error: "invalid_date" };
  if (isFutureDay(input.servicedAt, today)) return { ok: false, error: "future_date" };
  if (!input.serviceTypeKey.trim() && !input.description.trim()) {
    return { ok: false, error: "missing_service_type" };
  }
  if (input.invoiceDate && !SERVICE_DATE_RE.test(input.invoiceDate)) {
    return { ok: false, error: "invalid_invoice_date" };
  }
  if (input.invoiceDate && isFutureDay(input.invoiceDate, today)) {
    return { ok: false, error: "future_date" };
  }
  if (input.odometerKm != null && (!Number.isFinite(input.odometerKm) || input.odometerKm < 0)) {
    return { ok: false, error: "invalid_odometer" };
  }
  if (input.costKwd != null && (!Number.isFinite(input.costKwd) || input.costKwd < 0)) {
    return { ok: false, error: "invalid_cost" };
  }
  for (const part of input.parts) {
    if (!part.name.trim()) return { ok: false, error: "invalid_part" };
    if (!Number.isFinite(part.qty) || part.qty <= 0) return { ok: false, error: "invalid_part" };
    if (!Number.isFinite(part.unit_cost_kwd) || part.unit_cost_kwd < 0) {
      return { ok: false, error: "invalid_part" };
    }
  }
  return { ok: true };
}

export function stageEvent(
  stage: ServiceStage,
  at: string,
  by: string | null,
  byName: string | null,
  note: string | null,
) {
  return { stage, at, by, by_name: byName, note: note ?? null };
}
