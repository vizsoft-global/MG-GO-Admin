import type { ServiceAttachmentMeta, ServicePart, ServiceRecordRow, ServiceStage } from "./types";
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

/**
 * Can this record be edited in place?
 *
 * **Yes, at every stage — including Done.** The fleet team asked for full control
 * over maintenance data and named Done records explicitly: a wrong invoice number
 * or a mistyped odometer on a closed visit has to be correctable without filing a
 * second visit that never happened, because the maintenance baseline counts days
 * from that record.
 *
 * That does not make the correction invisible. `updateServiceRecord` appends a
 * stage-history row naming the edit, and a Done record keeps `done_at` and
 * `done_odometer_km` in step with what was edited — so the baseline moves with the
 * correction instead of drifting away from it.
 */
export function canEditServiceStage(stage: ServiceStage): boolean {
  // True for every real stage; the lookup is what makes an unknown value safe
  // rather than editable.
  return SERVICE_STAGES.includes(stage);
}

/**
 * The completion instant a Done record carries after its service date is edited.
 *
 * The time of day is preserved (that is when the work was signed off) and only the
 * date moves, because `recordDay()` reads `done_at` first and every maintenance
 * due date counts from it. Writing a fresh `now()` here would silently shift a
 * baseline to the day of the correction.
 */
export function retimedDoneAt(servicedAt: string, previousDoneAt: string | null): string {
  const time = (previousDoneAt ?? "").slice(10);
  const clock = /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) ? time : "T00:00:00.000Z";
  return `${servicedAt.slice(0, 10)}${clock}`;
}

export type ServiceEditFields = {
  servicedAt: string;
  odometerKm: number | null;
  costKwd: number | null;
  parts: readonly ServicePart[];
  attachments?: readonly ServiceAttachmentMeta[];
};

/**
 * What an edit actually moved, in the words the stage history records.
 *
 * A correction to a Done record rewrites the maintenance baseline, so the history
 * has to say *which* fact moved — "Edited after done" alone would leave the next
 * operator unable to tell a date correction from a typo in the invoice number.
 */
export function serviceEditSummary(
  before: Record<string, unknown>,
  next: ServiceEditFields,
): string[] {
  const labels: string[] = [];
  const previousDay = recordDay(before);
  if (previousDay && previousDay !== next.servicedAt.slice(0, 10)) labels.push("service date");
  if (odometerOf(before) !== next.odometerKm) labels.push("odometer");
  if (positiveNumber(before.cost_kwd) !== next.costKwd) labels.push("cost");
  if (normaliseParts(before.parts).length !== next.parts.length) labels.push("spare parts");
  const previousFiles = Array.isArray(before.attachments) ? before.attachments.length : 0;
  if (next.attachments && previousFiles !== next.attachments.length) {
    labels.push("attachments");
  }
  return labels;
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
  /** Allowed only with `allowBelow` — the caller must demand a reason. */
  | { action: "lower"; km: number; currentKm: number }
  | { action: "invalid" };

/**
 * The monotonic guard.
 *
 * A **machine** reading can only move the stored figure up: a dashcam that
 * reports `78 500` for a vehicle at `185 000` is wrong, and writing it would hide
 * every overdue service behind a fresh-looking baseline. That is why the guard is
 * applied on the dashcam sync and the baseline import, which nobody is watching.
 *
 * A **person** correcting the odometer is a different case — a typo, a replaced
 * instrument cluster, a bike whose meter was reset all need the figure to come
 * down. `allowBelow` therefore returns `{ action: "lower" }` so the caller can
 * demand a written reason and keep an audit row; without the flag the reading is
 * refused exactly as before.
 */
export function odometerDecision(
  currentKm: number | null | undefined,
  reading: number | null | undefined,
  options: { allowBelow?: boolean } = {},
): OdometerDecision {
  if (reading == null) return { action: "skip" };
  if (!Number.isFinite(reading) || reading < 0) return { action: "invalid" };
  if (currentKm == null || !Number.isFinite(currentKm)) return { action: "set", km: reading };
  if (reading > currentKm) return { action: "set", km: reading };
  if (reading === currentKm) return { action: "same", km: reading };
  if (options.allowBelow) return { action: "lower", km: reading, currentKm };
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
  /**
   * Files to keep on the record. Optional so an older caller (a test, the import
   * paths) can omit it; the action reads a missing value as "leave as it is" on an
   * edit and "no files" on a create.
   */
  attachments?: ServiceAttachmentMeta[];
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
