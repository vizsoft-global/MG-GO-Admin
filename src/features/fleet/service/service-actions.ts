"use server";

/**
 * Fleet Service — write actions and the client-facing read wrappers.
 *
 * The reads themselves live in `service-reads.ts`, a plain server module, so a
 * **server component** can call them directly. Calling a `"use server"` action
 * from a server component works on a full page load but breaks client-side
 * navigation (`Error: An unexpected response was received from the server`), so
 * pages import from `service-reads` and client components call the wrappers here.
 */
import { revalidatePath } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { COLLECTIONS } from "@/lib/firebase/db";
import type { ServiceCategoryKey } from "./service-types";
import {
  canTransitionStage,
  stageEvent,
  isTerminalStage,
  normaliseParts,
  odometerDecision,
  odometerOf,
  positiveNumber,
  recordStage,
  transitionRequiresNote,
  validateServiceRecordInput,
  type ServiceRecordInput,
} from "./service-records-model";
import {
  driverNameOf,
  loadServiceType,
  loadVehicleRow,
  mapStageHistory,
  num,
  openDb,
  requireService,
  sessionName,
  str,
  vehicleSnapshotOf,
  type Row,
} from "./service-reads";
import * as reads from "./service-reads";
import type {
  MaintenanceSettings,
  ServicePart,
  ServiceRecordRow,
  ServiceStage,
  ServiceTypeRow,
  ServiceVehicleOption,
  ServiceVehicleSnapshot,
} from "./types";

const SERVICE_SETTINGS_DOC = "current";

/* ---------------------------------------------------------------- reads ---
 * Thin async wrappers. A client component may only import a `"use server"`
 * module, so every read it needs is re-exported here. */

export async function listServiceRecords(): Promise<ServiceRecordRow[]> {
  return reads.listServiceRecords();
}

export async function getServiceRecord(id: string): Promise<ServiceRecordRow | null> {
  return reads.getServiceRecord(id);
}

export async function listServiceRecordsForVehicle(
  vehicleId: string,
): Promise<ServiceRecordRow[]> {
  return reads.listServiceRecordsForVehicle(vehicleId);
}

export async function listServiceVehicleOptions(): Promise<ServiceVehicleOption[]> {
  return reads.listServiceVehicleOptions();
}

export async function listServiceTypes(): Promise<ServiceTypeRow[]> {
  return reads.listServiceTypes();
}

export async function listMaintenanceSchedules() {
  return reads.listMaintenanceSchedules();
}

export async function listServiceMaintenanceData() {
  return reads.listServiceMaintenanceData();
}

export async function listServiceReportData() {
  return reads.listServiceReportData();
}

export async function listVehicleModels() {
  return reads.listVehicleModels();
}

export async function canExportServiceReports(): Promise<boolean> {
  return reads.canExportServiceReports();
}

/* --------------------------------------------------------------- writes --- */

type PreparedRecord = {
  vehicle_id: string;
  serviced_at: Date;
  service_type_key: string | null;
  service_type_label: string | null;
  category: ServiceCategoryKey;
  description: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_snapshot: ServiceVehicleSnapshot;
  invoice_no: string | null;
  invoice_date: string | null;
  company: string | null;
  vendor: string | null;
  notes: string | null;
  odometer_km: number | null;
  cost_kwd: number | null;
  parts: ServicePart[];
};

/**
 * Turns the form input into the stored fields. `odometer` is written beside
 * `odometer_km` on purpose: the legacy column is what any older reader still
 * looks at, and the rider payload shape must not change.
 */
async function prepareRecord(
  input: ServiceRecordInput,
  vehicle: Row,
  today: string,
): Promise<{ ok: true; prepared: PreparedRecord } | { ok: false; error: string }> {
  const parts = normaliseParts(input.parts);
  const validation = validateServiceRecordInput({ ...input, parts }, today);
  if (!validation.ok) return { ok: false, error: validation.error };

  const typeRow = await loadServiceType(input.serviceTypeKey);
  const driverId = input.driverId.trim();
  const driverName = driverId ? await driverNameOf(driverId) : null;

  return {
    ok: true,
    prepared: {
      vehicle_id: input.vehicleId,
      serviced_at: new Date(`${input.servicedAt}T00:00:00.000Z`),
      service_type_key: input.serviceTypeKey.trim() || null,
      service_type_label: typeRow?.label_en ?? (input.description.trim() || null),
      category: typeRow?.category ?? "other",
      description: input.description.trim() || null,
      driver_id: driverId || null,
      driver_name: driverName,
      vehicle_snapshot: vehicleSnapshotOf(vehicle),
      invoice_no: input.invoiceNo.trim() || null,
      invoice_date: input.invoiceDate.trim() || null,
      company: input.company.trim() || null,
      vendor: input.vendor.trim() || null,
      notes: input.notes.trim() || null,
      odometer_km: input.odometerKm,
      cost_kwd: input.costKwd,
      parts,
    },
  };
}

export async function createServiceRecord(
  input: ServiceRecordInput,
): Promise<{ id: string } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicle = await loadVehicleRow(input.vehicleId);
  if (!vehicle) return { error: "missing_vehicle" };

  const prepared = await prepareRecord(input, vehicle, kuwaitTodayYmd());
  if (!prepared.ok) return { error: prepared.error };

  const db = await openDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const by = auth.session.id;
  const record = {
    id,
    ...prepared.prepared,
    kind: prepared.prepared.service_type_label ?? "service",
    odometer: prepared.prepared.odometer_km,
    stage: "new" as ServiceStage,
    stage_history: [stageEvent("new", now.toISOString(), by, sessionName(auth.session), null)],
    done_at: null,
    done_odometer_km: null,
    created_by: by,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection(COLLECTIONS.vehicleServices).doc(id).set(record);
  } catch {
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "create",
    entityType: "vehicle_service",
    entityId: id,
    routeName: "/fleet/service",
    after: {
      vehicle_id: record.vehicle_id,
      service_type_key: record.service_type_key,
      stage: record.stage,
      cost_kwd: record.cost_kwd,
      odometer_km: record.odometer_km,
      parts: record.parts.length,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath(`/vehicles/${record.vehicle_id}`);
  return { id };
}

export async function updateServiceRecord(
  id: string,
  input: ServiceRecordInput,
): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const db = await openDb();
  const ref = db.collection(COLLECTIONS.vehicleServices).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "not_found" };
  const before = { id: snap.id, ...(snap.data() ?? {}) } as Row;
  // Done and Cancelled are terminal: the maintenance baseline must not be
  // rewritten after the fact, so a correction is a new record.
  if (isTerminalStage(recordStage(before))) return { error: "record_locked" };

  const vehicle = await loadVehicleRow(input.vehicleId);
  if (!vehicle) return { error: "missing_vehicle" };
  const prepared = await prepareRecord(input, vehicle, kuwaitTodayYmd());
  if (!prepared.ok) return { error: prepared.error };

  try {
    await ref.update({
      ...prepared.prepared,
      kind: prepared.prepared.service_type_label ?? "service",
      odometer: prepared.prepared.odometer_km,
      updated_at: new Date(),
    });
  } catch {
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "update",
    entityType: "vehicle_service",
    entityId: id,
    routeName: "/fleet/service",
    before: {
      service_type_key: str(before.service_type_key) || null,
      cost_kwd: num(before.cost_kwd),
      odometer_km: odometerOf(before),
    },
    after: {
      service_type_key: prepared.prepared.service_type_key,
      cost_kwd: prepared.prepared.cost_kwd,
      odometer_km: prepared.prepared.odometer_km,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath(`/fleet/service/records/${id}`);
  revalidatePath(`/vehicles/${input.vehicleId}`);
  return { ok: true };
}


export type StageResult =
  | { ok: true }
  | {
      error:
        | "not_authorized"
        | "not_found"
        | "invalid_transition"
        | "note_required"
        | "odometer_below_current"
        | "save_failed";
      currentKm?: number;
    };

/**
 * The only path that writes `done_at`, advances `vehicles.current_odometer_km`,
 * appends an odometer reading and therefore moves the maintenance baseline.
 * The kilometre guard is checked **before** anything is written.
 */
export async function setServiceStage(input: {
  id: string;
  stage: ServiceStage;
  note?: string;
}): Promise<StageResult> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: "not_authorized" };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const db = await openDb();
  const ref = db.collection(COLLECTIONS.vehicleServices).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "not_found" };
  const before = { id: snap.id, ...(snap.data() ?? {}) } as Row;

  const from = recordStage(before);
  if (!canTransitionStage(from, input.stage)) return { error: "invalid_transition" };
  const note = (input.note ?? "").trim();
  if (transitionRequiresNote(input.stage) && !note) return { error: "note_required" };

  const vehicleId = str(before.vehicle_id);
  const reading = odometerOf(before);
  const now = new Date();
  const by = auth.session.id;

  const history = [...mapStageHistory(before.stage_history)];
  history.push(
    stageEvent(input.stage, now.toISOString(), by, sessionName(auth.session), note || null),
  );

  const recordUpdate: Record<string, unknown> = {
    stage: input.stage,
    stage_history: history,
    updated_at: now,
  };

  let vehicleKm: number | null = null;
  let readingId: string | null = null;

  if (input.stage === "done") {
    recordUpdate.done_at = now.toISOString();
    recordUpdate.done_odometer_km = reading;

    const vehicle = await loadVehicleRow(vehicleId);
    const decision = odometerDecision(num(vehicle?.current_odometer_km), reading);
    if (decision.action === "invalid") return { error: "invalid_transition" };
    if (decision.action === "refuse_below") {
      void logAdminMutation({
        action: "update",
        entityType: "vehicle_service",
        entityId: input.id,
        routeName: "/fleet/service",
        success: false,
        errorMessage: "odometer_below_current",
        context: { reading: decision.km, current_km: decision.currentKm },
      });
      return { error: "odometer_below_current", currentKm: decision.currentKm };
    }
    if (decision.action === "set" && vehicle) {
      vehicleKm = decision.km;
      readingId = crypto.randomUUID();
    }
  }

  try {
    const batch = db.batch();
    batch.update(ref, recordUpdate);
    if (vehicleKm != null && readingId) {
      batch.update(db.collection(COLLECTIONS.vehicles).doc(vehicleId), {
        current_odometer_km: vehicleKm,
        odometer_source: "service",
        odometer_updated_at: now,
      });
      batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(readingId), {
        id: readingId,
        vehicle_id: vehicleId,
        km: vehicleKm,
        source: "service",
        at: now,
        recorded_by: by,
        service_id: input.id,
        created_at: now,
      });
    }
    await batch.commit();
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_service",
    entityId: input.id,
    routeName: "/fleet/service",
    before: { stage: from },
    after: { stage: input.stage, note: note || null, odometer_km: reading },
  });
  revalidatePath("/fleet/service");
  revalidatePath(`/fleet/service/records/${input.id}`);
  revalidatePath(`/vehicles/${vehicleId}`);
  return { ok: true };
}


/** The manual door onto the same reading table. `service.manage`, audited. */
export async function recordManualOdometer(input: {
  vehicleId: string;
  km: number;
}): Promise<{ ok: true; km: number | null } | { error: string; currentKm?: number }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicle = await loadVehicleRow(input.vehicleId);
  if (!vehicle) return { error: "not_found" };

  const currentKm = num(vehicle.current_odometer_km);
  const decision = odometerDecision(currentKm, input.km);
  if (decision.action === "invalid") return { error: "invalid_odometer" };
  if (decision.action === "skip") return { ok: true, km: currentKm };
  if (decision.action === "refuse_below") {
    return { error: "odometer_below_current", currentKm: decision.currentKm };
  }
  if (decision.action === "same") return { ok: true, km: currentKm };

  const db = await openDb();
  const now = new Date();
  const id = crypto.randomUUID();
  try {
    const batch = db.batch();
    batch.update(db.collection(COLLECTIONS.vehicles).doc(input.vehicleId), {
      current_odometer_km: decision.km,
      odometer_source: "manual",
      odometer_updated_at: now,
    });
    batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(id), {
      id,
      vehicle_id: input.vehicleId,
      km: decision.km,
      source: "manual",
      at: now,
      recorded_by: auth.session.id,
      created_at: now,
    });
    await batch.commit();
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_odometer",
    entityId: input.vehicleId,
    routeName: "/vehicles",
    before: { current_odometer_km: currentKm },
    after: { current_odometer_km: decision.km, source: "manual" },
  });
  revalidatePath(`/vehicles/${input.vehicleId}`);
  revalidatePath("/fleet/service");
  return { ok: true, km: decision.km };
}

function intervalValue(value: unknown, fallback: number): number {
  const n = positiveNumber(value);
  if (n == null || n < 0) return fallback;
  return Math.round(n);
}

/**
 * Fleet-default intervals. `confirm` is the admin's "Confirm intervals" press —
 * the only thing that clears `provisional`.
 */
export async function saveMaintenanceSettings(input: {
  kmInterval: number;
  dayInterval: number;
  alertKm: number;
  alertDays: number;
  confirm?: boolean;
}): Promise<{ ok: true; settings: MaintenanceSettings } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const before = await reads.getMaintenanceSettings();
  const next: MaintenanceSettings = {
    km_interval: intervalValue(input.kmInterval, before.km_interval),
    day_interval: intervalValue(input.dayInterval, before.day_interval),
    alert_km: intervalValue(input.alertKm, before.alert_km),
    alert_days: intervalValue(input.alertDays, before.alert_days),
    provisional: input.confirm ? false : before.provisional,
    approved_at: input.confirm ? new Date().toISOString() : before.approved_at,
    approved_by: input.confirm ? auth.session.id : before.approved_by,
    updated_at: new Date().toISOString(),
    updated_by: auth.session.id,
  };

  const db = await openDb();
  try {
    await db
      .collection(COLLECTIONS.serviceMaintenanceSettings)
      .doc(SERVICE_SETTINGS_DOC)
      .set(next, { merge: true });
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "service_maintenance_settings",
    entityId: SERVICE_SETTINGS_DOC,
    routeName: "/fleet/service",
    before: {
      km_interval: before.km_interval,
      day_interval: before.day_interval,
      alert_km: before.alert_km,
      alert_days: before.alert_days,
      provisional: before.provisional,
    },
    after: {
      km_interval: next.km_interval,
      day_interval: next.day_interval,
      alert_km: next.alert_km,
      alert_days: next.alert_days,
      provisional: next.provisional,
    },
  });
  revalidatePath("/fleet/service");
  return { ok: true, settings: next };
}


export async function saveMaintenanceSchedule(input: {
  id?: string | null;
  scope: "vehicle" | "model";
  vehicleId?: string | null;
  makeModelKey?: string | null;
  serviceTypeKey: string;
  serviceTypeLabel?: string | null;
  kmInterval: number;
  dayInterval: number;
  alertKm: number;
  alertDays: number;
  isActive: boolean;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicleId = (input.vehicleId ?? "").trim();
  const modelKey = (input.makeModelKey ?? "").trim();
  if (input.scope === "vehicle" && !vehicleId) return { error: "missing_vehicle" };
  if (input.scope === "model" && !modelKey) return { error: "missing_model" };
  if (!input.serviceTypeKey.trim()) return { error: "missing_service_type" };

  const db = await openDb();
  const id = input.id || crypto.randomUUID();
  const ref = db.collection(COLLECTIONS.vehicleMaintenanceSchedules).doc(id);
  const snap = await ref.get();
  const before = snap.exists ? ({ id: snap.id, ...(snap.data() ?? {}) } as Row) : null;

  const payload = {
    id,
    scope: input.scope,
    vehicle_id: input.scope === "vehicle" ? vehicleId : null,
    make_model_key: input.scope === "model" ? modelKey : null,
    service_type_key: input.serviceTypeKey.trim(),
    service_type_label: (input.serviceTypeLabel ?? "").trim() || null,
    km_interval: intervalValue(input.kmInterval, 0),
    day_interval: intervalValue(input.dayInterval, 0),
    alert_km: intervalValue(input.alertKm, 0),
    alert_days: intervalValue(input.alertDays, 0),
    is_active: input.isActive,
    updated_at: new Date(),
  };

  try {
    await ref.set(
      before ? payload : { ...payload, created_at: new Date(), created_by: auth.session.id },
      { merge: true },
    );
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: before ? "update" : "create",
    entityType: "vehicle_maintenance_schedule",
    entityId: id,
    routeName: "/fleet/service",
    before: before
      ? {
          scope: str(before.scope),
          km_interval: num(before.km_interval),
          day_interval: num(before.day_interval),
          is_active: before.is_active !== false,
        }
      : null,
    after: {
      scope: payload.scope,
      vehicle_id: payload.vehicle_id,
      make_model_key: payload.make_model_key,
      service_type_key: payload.service_type_key,
      km_interval: payload.km_interval,
      day_interval: payload.day_interval,
      is_active: payload.is_active,
    },
  });
  revalidatePath("/fleet/service");
  return { ok: true, id };
}

