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
import { getPresignedGetUrl, putObject } from "@/lib/storage/r2-client";
import { buildVehicleFileKey, extensionFromMime, isR2ObjectKey } from "@/lib/storage/r2-keys";
import type { ServiceCategoryKey } from "./service-types";
import {
  canEditServiceStage,
  canTransitionStage,
  retimedDoneAt,
  serviceEditSummary,
  stageEvent,
  isFutureDay,
  isTerminalStage,
  normaliseParts,
  odometerDecision,
  odometerOf,
  positiveNumber,
  recordStage,
  SERVICE_DATE_RE,
  transitionRequiresNote,
  validateServiceRecordInput,
  type ServiceRecordInput,
} from "./service-records-model";
import {
  MAX_SERVICE_ATTACHMENTS,
  SERVICE_ATTACHMENT_FOLDER,
  normaliseServiceAttachments,
  serviceAttachmentKeyProblem,
  serviceUploadBlockReason,
} from "./service-attachments-model";
import { exclusionId } from "./service-maintenance-model";
import { previewBaselineImport, type BaselineFleetVehicle } from "./service-baseline-import";
import { previewBikeImport, type BikeFleetVehicle } from "./service-bike-import";
import {
  driverNameOf,
  employeeIdentityOf,
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
  MaintenanceRuleScope,
  MaintenanceSettings,
  OdometerSyncConfig,
  ServiceAttachmentMeta,
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

export async function listServiceMaintenanceData(options?: {
  vehicleTypeKeys?: readonly string[];
  today?: string;
}) {
  return reads.listServiceMaintenanceData(options);
}

export async function listMaintenanceExclusions() {
  return reads.listMaintenanceExclusions();
}

export async function listVehicleDayDistances(day: string) {
  return reads.listVehicleDayDistances(day);
}

export async function getOdometerSyncConfig() {
  return reads.getOdometerSyncConfig();
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
  employee_id: string | null;
  vehicle_snapshot: ServiceVehicleSnapshot;
  invoice_no: string | null;
  invoice_date: string | null;
  company: string | null;
  vendor: string | null;
  notes: string | null;
  odometer_km: number | null;
  cost_kwd: number | null;
  parts: ServicePart[];
  attachments: ServiceAttachmentMeta[];
};

/**
 * Turns the form input into the stored fields. `odometer` is written beside
 * `odometer_km` on purpose: the legacy column is what any older reader still
 * looks at, and the rider payload shape must not change.
 *
 * The employee block is **derived, not typed**: the MG ID and the company come
 * from the linked driver document, and an operator's own company text only wins
 * when no rider is linked. That is what "automatically retrieve based on the
 * employee" means on an invoice — a company that disagrees with the roster is a
 * data-entry mistake, not an override.
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
  const identity = driverId
    ? await employeeIdentityOf(driverId)
    : { name: null, employeeId: null, company: null };

  const attachments: ServiceAttachmentMeta[] = [];
  for (const attachment of input.attachments ?? []) {
    const problem = serviceAttachmentKeyProblem(attachment.key, { vehicleId: input.vehicleId });
    if (problem) return { ok: false, error: problem };
  }
  if ((input.attachments ?? []).length > MAX_SERVICE_ATTACHMENTS) {
    return { ok: false, error: "too_many_attachments" };
  }
  for (const attachment of normaliseServiceAttachments(input.attachments ?? [])) {
    attachments.push(attachment);
  }

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
      driver_name: identity.name ?? (driverId ? await driverNameOf(driverId) : null),
      employee_id: identity.employeeId,
      vehicle_snapshot: vehicleSnapshotOf(vehicle),
      invoice_no: input.invoiceNo.trim() || null,
      invoice_date: input.invoiceDate.trim() || null,
      company: identity.company ?? (input.company.trim() || null),
      vendor: input.vendor.trim() || null,
      notes: input.notes.trim() || null,
      odometer_km: input.odometerKm,
      cost_kwd: input.costKwd,
      parts,
      attachments,
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
  const stage = recordStage(before);
  // Every stage is editable, Done included — the fleet team owns the record. The
  // correction is written, not hidden: a terminal record gets a history row and a
  // Done record keeps `done_at` / `done_odometer_km` in step with the edit, so the
  // maintenance baseline moves with it instead of drifting away from it.
  if (!canEditServiceStage(stage)) return { error: "record_locked" };

  const vehicle = await loadVehicleRow(input.vehicleId);
  if (!vehicle) return { error: "missing_vehicle" };
  const prepared = await prepareRecord(input, vehicle, kuwaitTodayYmd());
  if (!prepared.ok) return { error: prepared.error };

  const now = new Date();
  const by = auth.session.id;
  const history = mapStageHistory(before.stage_history);
  const patch: Record<string, unknown> = {
    ...prepared.prepared,
    kind: prepared.prepared.service_type_label ?? "service",
    odometer: prepared.prepared.odometer_km,
    updated_at: now,
  };

  if (isTerminalStage(stage)) {
    const edited = serviceEditSummary(before, {
      servicedAt: input.servicedAt,
      odometerKm: input.odometerKm,
      costKwd: input.costKwd,
      parts: prepared.prepared.parts,
      attachments: input.attachments,
    });
    history.push(
      stageEvent(
        stage,
        now.toISOString(),
        by,
        sessionName(auth.session),
        edited.length > 0
          ? `Edited after ${stage}: ${edited.join(", ")}.`
          : `Edited after ${stage}.`,
      ),
    );
    patch.stage_history = history;
  }

  // A caller that does not speak attachments (the import paths) must not erase the
  // files an operator already filed. Only an explicit array replaces the list.
  if (input.attachments === undefined) {
    patch.attachments = normaliseServiceAttachments(before.attachments);
  }

  let vehicleKm: number | null = null;
  let readingId: string | null = null;
  if (stage === "done") {
    patch.done_at = retimedDoneAt(input.servicedAt, str(before.done_at) || null);
    patch.done_odometer_km = input.odometerKm;
    // A correction upward is a real measurement; a correction downward is the
    // operator fixing a typo, and `recordManualOdometer` is the door for that, so
    // the vehicle figure only ever steps forward here.
    const decision = odometerDecision(
      num(vehicle.current_odometer_km),
      input.odometerKm,
    );
    if (decision.action === "set") {
      vehicleKm = decision.km;
      readingId = crypto.randomUUID();
    }
  }

  try {
    const batch = db.batch();
    batch.update(ref, patch);
    if (vehicleKm != null && readingId) {
      batch.update(db.collection(COLLECTIONS.vehicles).doc(input.vehicleId), {
        current_odometer_km: vehicleKm,
        odometer_source: "service",
        odometer_updated_at: now,
      });
      batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(readingId), {
        id: readingId,
        vehicle_id: input.vehicleId,
        km: vehicleKm,
        source: "service",
        at: now,
        recorded_by: by,
        service_id: id,
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
    entityId: id,
    routeName: "/fleet/service",
    before: {
      stage,
      service_type_key: str(before.service_type_key) || null,
      cost_kwd: num(before.cost_kwd),
      odometer_km: odometerOf(before),
      attachments: normaliseServiceAttachments(before.attachments).length,
    },
    after: {
      service_type_key: prepared.prepared.service_type_key,
      cost_kwd: prepared.prepared.cost_kwd,
      odometer_km: prepared.prepared.odometer_km,
      attachments: prepared.prepared.attachments.length,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath(`/fleet/service/records/${id}`);
  revalidatePath(`/vehicles/${input.vehicleId}`);
  return { ok: true };
}


/* -------------------------------------------------------- attachments --- */

const SERVICE_SIGNED_URL_TTL = 900;

/**
 * Put one file into `vehicles/{vehicleId}/service/…` and hand back the metadata the
 * record stores.
 *
 * The object is written before the record references it, exactly like an accident
 * photo, so a failed save leaves an unreferenced object rather than a record that
 * claims a file nobody can open. `entityId` is the vehicle, not the record: the
 * record does not exist yet on the create screen.
 */
export async function uploadServiceAttachment(
  formData: FormData,
): Promise<{ attachment: ServiceAttachmentMeta } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const file = formData.get("file");
  if (!vehicleId || !(file instanceof File) || file.size === 0) {
    return { error: "missing_fields" };
  }
  const block = serviceUploadBlockReason({
    size: file.size,
    contentType: file.type || "",
    existingCount: 0,
  });
  if (block) return { error: block };

  const key = buildVehicleFileKey(vehicleId, SERVICE_ATTACHMENT_FOLDER, extensionFromMime(file.type));
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", {
      uploadedBy: auth.session.id,
      entityType: "vehicle_service",
      entityId: vehicleId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }
  return {
    attachment: {
      key,
      file_name: file.name.slice(0, 180) || null,
      kind: "admin_upload",
      content_type: file.type || null,
      size: file.size,
      uploaded_by: auth.session.id,
      at: new Date().toISOString(),
    },
  };
}

/**
 * A short-lived GET for one attachment.
 *
 * A key is signed **only** when a service record actually references it, so a
 * `service.view` account cannot name an arbitrary `drivers/…` object and read it.
 */
export async function resolveServiceAttachments(
  keys: readonly string[],
): Promise<{ key: string; url: string | null }[]> {
  const auth = await requireService("service.view");
  if ("error" in auth) return [];
  const wanted = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];

  const db = await openDb();
  const records = await db.collection(COLLECTIONS.vehicleServices).get();
  const claimed = new Set<string>();
  for (const doc of records.docs) {
    for (const attachment of normaliseServiceAttachments(doc.get("attachments"))) {
      claimed.add(attachment.key);
    }
  }

  const out: { key: string; url: string | null }[] = [];
  for (const key of wanted) {
    if (!isR2ObjectKey(key) || !claimed.has(key)) {
      out.push({ key, url: null });
      continue;
    }
    try {
      out.push({ key, url: await getPresignedGetUrl(key, SERVICE_SIGNED_URL_TTL) });
    } catch {
      out.push({ key, url: null });
    }
  }
  return out;
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


/**
 * The manual door onto the same reading table.
 *
 * A person correcting the odometer may lower it — a typo, a replaced instrument
 * cluster, a meter reset — but only with a **written reason**, and the change is
 * audited with the before/after pair and the reason itself. The monotonic guard
 * stays where nobody is watching: the dashcam sync and the baseline import.
 */
export async function recordManualOdometer(input: {
  vehicleId: string;
  km: number;
  /** Required when the new reading is below the stored one. */
  reason?: string | null;
}): Promise<{ ok: true; km: number | null } | { error: string; currentKm?: number }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicle = await loadVehicleRow(input.vehicleId);
  if (!vehicle) return { error: "not_found" };

  const currentKm = num(vehicle.current_odometer_km);
  const reason = (input.reason ?? "").trim();
  const decision = odometerDecision(currentKm, input.km, { allowBelow: true });
  if (decision.action === "invalid") return { error: "invalid_odometer" };
  if (decision.action === "skip") return { ok: true, km: currentKm };
  if (decision.action === "same") return { ok: true, km: currentKm };
  if (decision.action === "refuse_below") {
    return { error: "odometer_below_current", currentKm: decision.currentKm };
  }
  // A correction downward is the one path the guard does not simply refuse, and
  // it is the one path that must say why.
  if (decision.action === "lower" && !reason) {
    return { error: "reason_required", currentKm: decision.currentKm };
  }

  const db = await openDb();
  const now = new Date();
  const id = crypto.randomUUID();
  const lowered = decision.action === "lower";
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
      // The previous figure is kept on the reading itself, so the history of a
      // lowered odometer is readable without joining the audit log.
      previous_km: lowered ? decision.currentKm : null,
      lowered,
      reason: reason || null,
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
    after: {
      current_odometer_km: decision.km,
      source: "manual",
      lowered,
      ...(reason ? { reason } : {}),
    },
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
  scope: MaintenanceRuleScope;
  vehicleId?: string | null;
  makeModelKey?: string | null;
  makeKey?: string | null;
  vehicleTypeKey?: string | null;
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
  const ownMake = (input.makeKey ?? "").trim();
  const typeKey = (input.vehicleTypeKey ?? "").trim().toLowerCase();
  if (input.scope === "vehicle" && !vehicleId) return { error: "missing_vehicle" };
  if (input.scope === "make_model" && !modelKey) return { error: "missing_model" };
  if (input.scope === "make" && !ownMake) return { error: "missing_make" };
  if (input.scope === "vehicle_type" && !typeKey) return { error: "missing_vehicle_type" };
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
    make_model_key: input.scope === "make_model" ? modelKey : null,
    make_key: input.scope === "make" ? ownMake : null,
    vehicle_type_key: input.scope === "vehicle_type" ? typeKey : null,
    service_type_key: input.serviceTypeKey.trim(),
    service_type_label: (input.serviceTypeLabel ?? "").trim() || null,
    // 0 is a real value here: it means "this dimension is not tracked".
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
      make_key: payload.make_key,
      vehicle_type_key: payload.vehicle_type_key,
      service_type_key: payload.service_type_key,
      km_interval: payload.km_interval,
      day_interval: payload.day_interval,
      is_active: payload.is_active,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  return { ok: true, id };
}

/** Remove a rule. The vehicle falls back to the next wider scope, or the defaults. */
export async function deleteMaintenanceSchedule(input: {
  id: string;
}): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };
  if (!input.id.trim()) return { error: "not_found" };

  const db = await openDb();
  try {
    await db.collection(COLLECTIONS.vehicleMaintenanceSchedules).doc(input.id.trim()).delete();
  } catch {
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "vehicle_maintenance_schedule",
    entityId: input.id.trim(),
    routeName: "/fleet/service",
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  return { ok: true };
}


/* ------------------------------------------------ maintenance setup paths --- */

/**
 * `Not tracked` — the fleet team says this vehicle is not on this program (an
 * electric car has no oil change; a leased bike is serviced by its owner). The
 * opt-out is a document, so it is visible and reversible, and the row reads
 * `not_tracked` rather than a fabricated due date.
 */
export async function saveMaintenanceExclusion(input: {
  vehicleId: string;
  programKey: string;
  reason?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const vehicleId = input.vehicleId.trim();
  const programKey = input.programKey.trim();
  if (!vehicleId) return { error: "missing_vehicle" };
  if (!programKey) return { error: "missing_program" };

  const db = await openDb();
  const id = exclusionId(vehicleId, programKey);
  const now = new Date();
  try {
    await db
      .collection(COLLECTIONS.vehicleMaintenanceExclusions)
      .doc(id)
      .set(
        {
          id,
          vehicle_id: vehicleId,
          program_key: programKey,
          reason: (input.reason ?? "").trim() || null,
          by: auth.session.id,
          at: now,
          updated_at: now,
        },
        { merge: true },
      );
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "create",
    entityType: "vehicle_maintenance_exclusion",
    entityId: id,
    routeName: "/fleet/service",
    after: { vehicle_id: vehicleId, program_key: programKey },
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  return { ok: true };
}

export async function clearMaintenanceExclusion(input: {
  vehicleId: string;
  programKey: string;
}): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const db = await openDb();
  const id = exclusionId(input.vehicleId.trim(), input.programKey.trim());
  try {
    await db.collection(COLLECTIONS.vehicleMaintenanceExclusions).doc(id).delete();
  } catch {
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "vehicle_maintenance_exclusion",
    entityId: id,
    routeName: "/fleet/service",
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  return { ok: true };
}



/**
 * `Enter last service` — one Done record for one vehicle × program. This is the
 * only way a `needs_baseline` row becomes countable, and it is a real service
 * record (it can cost money and it appears on the records tab), not a hidden
 * offset.
 *
 * A kilometre or a date is enough: a km-only baseline leaves the day dimension at
 * `needs_baseline` rather than inventing a date.
 */
export async function saveMaintenanceBaseline(input: {
  vehicleId: string;
  programKey: string;
  /** Kuwait day `YYYY-MM-DD`. */
  serviceDay: string;
  odometerKm?: number | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const today = kuwaitTodayYmd();
  const vehicleId = input.vehicleId.trim();
  const programKey = input.programKey.trim();
  if (!vehicleId) return { error: "missing_vehicle" };
  if (!programKey) return { error: "missing_program" };
  if (!SERVICE_DATE_RE.test(input.serviceDay)) return { error: "invalid_date" };
  if (isFutureDay(input.serviceDay, today)) return { error: "future_date" };
  const odometerKm = input.odometerKm == null ? null : Math.round(input.odometerKm);
  if (odometerKm != null && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
    return { error: "invalid_odometer" };
  }

  const vehicle = await loadVehicleRow(vehicleId);
  if (!vehicle) return { error: "missing_vehicle" };
  const typeRow = await loadServiceType(programKey);

  const db = await openDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const stamp = now.toISOString();
  const name = sessionName(auth.session);
  try {
    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.vehicleServices).doc(id), {
      id,
      vehicle_id: vehicleId,
      // A baseline is a finished visit, so it carries the same shape a workshop
      // record does — the records tab has to be able to show it.
      serviced_at: new Date(`${input.serviceDay}T00:00:00.000Z`),
      kind: typeRow?.label_en ?? programKey,
      description: null,
      service_type_key: programKey,
      service_type_label: typeRow?.label_en ?? programKey,
      category: typeRow?.category ?? "other",
      stage: "done",
      source: "baseline",
      driver_id: null,
      driver_name: null,
      vehicle_snapshot: vehicleSnapshotOf(vehicle),
      invoice_no: null,
      invoice_date: null,
      company: null,
      odometer_km: odometerKm,
      odometer: odometerKm,
      cost_kwd: null,
      vendor: null,
      notes: (input.notes ?? "").trim() || "Baseline entered from the maintenance worklist.",
      parts: [],
      stage_history: [
        stageEvent("done", stamp, auth.session.id, name, "Baseline entered by the fleet team."),
      ],
      done_at: stamp,
      done_odometer_km: odometerKm,
      created_by: auth.session.id,
      created_at: now,
      updated_at: now,
    });

    // A baseline kilometre also raises the stored odometer, under the same
    // monotonic guard every other reading uses.
    const currentKm = num(vehicle.current_odometer_km);
    const decision = odometerDecision(currentKm, odometerKm);
    if (decision.action === "set") {
      batch.update(db.collection(COLLECTIONS.vehicles).doc(vehicleId), {
        current_odometer_km: decision.km,
        odometer_source: "baseline",
        odometer_updated_at: now,
      });
      const readingId = crypto.randomUUID();
      batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(readingId), {
        id: readingId,
        vehicle_id: vehicleId,
        km: decision.km,
        source: "baseline",
        at: now,
        recorded_by: auth.session.id,
        created_at: now,
      });
    }
    await batch.commit();
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "create",
    entityType: "service_baseline",
    entityId: id,
    routeName: "/fleet/service",
    after: {
      vehicle_id: vehicleId,
      program_key: programKey,
      day: input.serviceDay,
      km: odometerKm,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { ok: true, id };
}



/**
 * `Start monitoring from today` — the honest alternative to inventing a history.
 * One Done record dated today at the vehicle's stored odometer, so the program
 * starts counting from now instead of pretending a service happened last year.
 */
export async function startMaintenanceMonitoring(input: {
  vehicleId: string;
  programKey: string;
}): Promise<{ ok: true } | { error: string }> {
  const vehicle = await loadVehicleRow(input.vehicleId.trim());
  if (!vehicle) return { error: "missing_vehicle" };
  // A stale opt-out must not survive "start monitoring".
  const cleared = await clearMaintenanceExclusion(input);
  if ("error" in cleared) return cleared;
  const saved = await saveMaintenanceBaseline({
    vehicleId: input.vehicleId,
    programKey: input.programKey,
    serviceDay: kuwaitTodayYmd(),
    odometerKm: num(vehicle.current_odometer_km),
    notes: "Monitoring started from today by the fleet team.",
  });
  if ("error" in saved) return saved;
  return { ok: true };
}



/* ------------------------------------------------------- bulk import paths --- */

export type BaselineImportResult =
  | {
      ok: true;
      matchedByPlate: number;
      matchedByChassis: number;
      created: number;
      rejected: number;
      /** Rows blocked because `Current KM` was below `last service`. */
      blockedInconsistent: number;
      records: number;
    }
  | { error: string };

/**
 * Apply the client's baseline sheet.
 *
 * The sheet is sent as **rows** and the preview is recomputed here before a
 * single write, so the browser decided nothing and a tampered payload cannot
 * create a vehicle the matcher would have rejected.
 *
 * Writes, per row: the vehicle's `current_odometer_km` under the monotonic guard
 * (`source: "baseline"`), and one Done `vehicle_services` row filed under
 * `oil_change`. A row that matched neither plate nor chassis creates the car
 * first. Re-running the same sheet therefore creates nothing: every row it
 * created is found by its own plate on the second pass.
 */
export async function applyServiceBaselineImport(input: {
  rows: readonly (readonly unknown[])[];
}): Promise<BaselineImportResult> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { error: "empty_file" };

  const [options, rules] = await Promise.all([
    reads.listServiceVehicleOptions(),
    reads.listMaintenanceSchedules(),
  ]);
  const fleet: BaselineFleetVehicle[] = options.map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    chassisNo: vehicle.chassis_no,
    make: vehicle.make,
    model: vehicle.model,
    vehicleTypeKey: vehicle.vehicle_type_key,
    condition: vehicle.condition,
    zoneName: vehicle.zone_name,
    driverName: vehicle.driver_name,
    currentKm: vehicle.current_odometer_km,
  }));
  const preview = previewBaselineImport(input.rows, fleet, rules);
  const today = kuwaitTodayYmd();
  const typeRow = await loadServiceType("oil_change");

  const db = await openDb();
  const now = new Date();
  const stamp = now.toISOString();
  const name = sessionName(auth.session);
  let matchedByPlate = 0;
  let matchedByChassis = 0;
  let created = 0;
  let records = 0;

  for (const item of preview.items) {
    if (item.group === "reject") continue;

    let vehicleId = item.vehicleId;
    const storedKm = vehicleId
      ? fleet.find((row) => row.id === item.vehicleId)?.currentKm ?? null
      : null;

    if (!vehicleId) {
      // Neither identity matched: a car the fleet does not hold. The sheet's own
      // plate is stored, so a re-import finds the same car.
      const newRef = db.collection(COLLECTIONS.vehicles).doc();
      vehicleId = newRef.id;
      try {
        await newRef.set({
          id: newRef.id,
          bike_id: item.plate,
          reg_number: item.plate,
          chassis_no: item.chassisNo,
          make: item.make,
          model: item.model,
          model_year: null,
          car_type: null,
          vehicle_type_key: "car",
          status: "active",
          condition: "running",
          type_of_use: "operational",
          current_odometer_km: item.currentKm,
          odometer_source: item.currentKm == null ? null : "baseline",
          odometer_updated_at: item.currentKm == null ? null : now,
          created_at: now,
          updated_at: now,
          created_by: auth.session.id,
          source: "baseline_import",
        });
        created += 1;
      } catch {
        continue;
      }
    } else if (item.group === "plate") {
      matchedByPlate += 1;
    } else {
      matchedByChassis += 1;
    }


    // A row carrying no service history is a fleet addition only.
    if (item.lastServiceKm == null && !item.lastServiceDay) continue;

    const recordId = crypto.randomUUID();
    try {
      const batch = db.batch();
      // A row whose `Current KM` is below its last service figure has its odometer
      // write withheld: the service record still goes in, but nothing may rewind
      // the meter until the sheet is confirmed.
      const decision = item.odometerBlocked
        ? { action: "refuse_below" as const, km: 0, currentKm: 0 }
        : odometerDecision(storedKm, item.currentKm ?? item.lastServiceKm);
      if (decision.action === "set") {
        batch.update(db.collection(COLLECTIONS.vehicles).doc(vehicleId), {
          current_odometer_km: decision.km,
          odometer_source: "baseline",
          odometer_updated_at: now,
        });
        const readingId = crypto.randomUUID();
        batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(readingId), {
          id: readingId,
          vehicle_id: vehicleId,
          km: decision.km,
          source: "baseline",
          at: now,
          recorded_by: auth.session.id,
          created_at: now,
        });
      }
      batch.set(db.collection(COLLECTIONS.vehicleServices).doc(recordId), {
        id: recordId,
        vehicle_id: vehicleId,
        serviced_at: new Date(`${item.lastServiceDay ?? today}T00:00:00.000Z`),
        kind: typeRow?.label_en ?? "Oil change",
        description: null,
        service_type_key: "oil_change",
        service_type_label: typeRow?.label_en ?? "Oil change",
        category: typeRow?.category ?? "engine",
        stage: "done",
        source: "baseline",
        driver_id: null,
        driver_name: null,
        vehicle_snapshot: {
          plate: item.matchedPlate ?? item.plate,
          chassis_no: item.chassisNo,
          make: item.make,
          model: item.model,
          model_year: null,
          car_type: null,
        },
        invoice_no: null,
        invoice_date: null,
        company: null,
        odometer_km: item.lastServiceKm,
        odometer: item.lastServiceKm,
        cost_kwd: null,
        vendor: null,
        notes: `Baseline from the client sheet, row ${item.sheetRow}.`,
        parts: [],
        stage_history: [stageEvent("done", stamp, auth.session.id, name, "Baseline imported.")],
        done_at: stamp,
        done_odometer_km: item.lastServiceKm,
        created_by: auth.session.id,
        created_at: now,
        updated_at: now,
      });
      await batch.commit();
      records += 1;
    } catch {
      continue;
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "service_baseline_import",
    entityId: `${preview.counts.total}-rows`,
    routeName: "/fleet/service",
    after: {
      matched_by_plate: matchedByPlate,
      matched_by_chassis: matchedByChassis,
      created,
      rejected: preview.counts.reject,
      records,
    },
  });
  revalidatePath("/fleet/service");
  revalidatePath("/fleet/service/bikes");
  revalidatePath("/vehicles");
  return {
    ok: true,
    matchedByPlate,
    matchedByChassis,
    created,
    rejected: preview.counts.reject,
    blockedInconsistent: preview.kmBelowService,
    records,
  };
}



/* ------------------------------------------------------- bike record paths --- */

export type BikeImportResult =
  | { ok: true; created: number; rejected: number }
  | { error: string };

/**
 * Apply a bike service sheet. Bikes only: a car plate in the sheet is rejected by
 * the preview, never re-filed onto a bike, so a shared workbook cannot move a
 * bike's oil date with a car's service.
 */
export async function applyBikeServiceImport(input: {
  rows: readonly (readonly unknown[])[];
}): Promise<BikeImportResult> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { error: "empty_file" };

  const options = await reads.listServiceVehicleOptions();
  const fleet: BikeFleetVehicle[] = options.map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    chassisNo: vehicle.chassis_no,
    vehicleTypeKey: vehicle.vehicle_type_key,
  }));
  const today = kuwaitTodayYmd();
  const preview = previewBikeImport(input.rows, fleet, today);

  const typeRows = await Promise.all(
    ["oil_change", "brake", "chain"].map((key) => loadServiceType(key)),
  );
  const labelByKey = new Map<string, { label: string; category: ServiceCategoryKey }>();
  ["oil_change", "brake", "chain"].forEach((key, index) => {
    const row = typeRows[index];
    labelByKey.set(key, {
      label: row?.label_en ?? key,
      category: row?.category ?? "other",
    });
  });

  const db = await openDb();
  const now = new Date();
  const stamp = now.toISOString();
  const name = sessionName(auth.session);
  let created = 0;

  for (const item of preview.items) {
    if (item.group !== "create" || !item.vehicleId || !item.programKey || !item.serviceDay) {
      continue;
    }
    const meta = labelByKey.get(item.programKey);
    const id = crypto.randomUUID();
    try {
      const batch = db.batch();
      batch.set(db.collection(COLLECTIONS.vehicleServices).doc(id), {
        id,
        vehicle_id: item.vehicleId,
        serviced_at: new Date(`${item.serviceDay}T00:00:00.000Z`),
        kind: meta?.label ?? item.serviceTypeRaw,
        description: item.serviceTypeRaw || null,
        service_type_key: item.programKey,
        service_type_label: meta?.label ?? item.serviceTypeRaw,
        category: meta?.category ?? "other",
        stage: "done",
        source: "bike_import",
        driver_id: null,
        driver_name: null,
        vehicle_snapshot: {
          plate: item.matchedPlate ?? item.plate,
          chassis_no: null,
          make: null,
          model: null,
          model_year: null,
          car_type: null,
        },
        invoice_no: item.invoiceNo,
        invoice_date: null,
        company: null,
        odometer_km: item.odometerKm,
        odometer: item.odometerKm,
        cost_kwd: item.costKwd,
        vendor: item.vendor,
        notes: item.notes,
        parts: [],
        stage_history: [
          stageEvent("done", stamp, auth.session.id, name, "Imported from the bike service sheet."),
        ],
        done_at: stamp,
        done_odometer_km: item.odometerKm,
        created_by: auth.session.id,
        created_at: now,
        updated_at: now,
      });

      // A bike reading only raises the stored figure, never rewinds it.
      const stored = options.find((vehicle) => vehicle.id === item.vehicleId)?.current_odometer_km ?? null;
      const decision = odometerDecision(stored, item.odometerKm);
      if (decision.action === "set") {
        batch.update(db.collection(COLLECTIONS.vehicles).doc(item.vehicleId), {
          current_odometer_km: decision.km,
          odometer_source: "service",
          odometer_updated_at: now,
        });
        const readingId = crypto.randomUUID();
        batch.set(db.collection(COLLECTIONS.vehicleOdometerReadings).doc(readingId), {
          id: readingId,
          vehicle_id: item.vehicleId,
          km: decision.km,
          source: "service",
          at: now,
          recorded_by: auth.session.id,
          created_at: now,
        });
      }
      await batch.commit();
      created += 1;
    } catch {
      continue;
    }
  }

  void logAdminMutation({
    action: "create",
    entityType: "service_bike_import",
    entityId: `${preview.counts.total}-rows`,
    routeName: "/fleet/service/bikes",
    after: { created, rejected: preview.counts.reject },
  });
  revalidatePath("/fleet/service/bikes");
  revalidatePath("/fleet/service");
  return { ok: true, created, rejected: preview.counts.reject };
}



/* ------------------------------------------------- dashcam odometer feed --- */

/**
 * Save the dashcam feed settings. The vendor's published spec returns 500 from
 * outside their network, so the endpoint shape is configuration: the operator
 * fills these in and proves them with **Test connection**, and the four-times-a-
 * day sync needs no deploy when they change.
 */
export async function saveOdometerSyncConfig(
  input: Omit<OdometerSyncConfig, "last_run_at" | "last_run_summary" | "secret_configured">,
): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const baseUrl = (input.base_url ?? "").trim().replace(/\/+$/, "");
  if (input.enabled && !/^https?:\/\//i.test(baseUrl)) return { error: "invalid_base_url" };

  const db = await openDb();
  const now = new Date();
  try {
    await db
      .collection(COLLECTIONS.serviceOdometerSync)
      .doc(SERVICE_SETTINGS_DOC)
      .set(
        {
          enabled: input.enabled === true,
          base_url: baseUrl,
          auth_mode: input.auth_mode === "login" ? "login" : "headers",
          app_cid: (input.app_cid ?? "").trim(),
          // The secret is **not** stored here. It lives in Secret Manager for the
          // scheduled run and in the Vercel environment for Test connection; a
          // copy in Firestore would be readable by every staff reader and would
          // survive a rotation.
          app_secret: null,
          vehicles_path: (input.vehicles_path ?? "").trim() || "/vehicle/list",
          vehicle_path: (input.vehicle_path ?? "").trim() || "/vehicle/info?plate={plate}",
          odometer_field: (input.odometer_field ?? "").trim() || "odometer",
          plate_field: (input.plate_field ?? "").trim() || "plateNo",
          chassis_field: (input.chassis_field ?? "").trim() || "vin",
          updated_at: now,
          updated_by: auth.session.id,
        },
        { merge: true },
      );
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "service_odometer_sync",
    entityId: SERVICE_SETTINGS_DOC,
    routeName: "/fleet/service",
    // Neither the secret nor a hash of it is written to the audit row.
    after: {
      enabled: input.enabled === true,
      base_url: baseUrl,
      auth_mode: input.auth_mode,
      secret_configured: Boolean((process.env.SERVICE_ODOMETER_APP_SECRET ?? "").trim()),
    },
  });
  revalidatePath("/fleet/service");
  return { ok: true };
}

export type OdometerTestResult =
  | {
      ok: true;
      status: number;
      /** The first row the endpoint answered, so the field names are provable. */
      sample: Record<string, unknown> | null;
      /** How many rows came back, before any mapping. */
      rows: number;
    }
  | { error: string; status?: number; message?: string };

/**
 * **Test connection** — call the configured path once and show the raw first row.
 * That is how the real field names are settled in the panel instead of by a
 * deploy, and it is the only way to prove the credential before the scheduled
 * sync is switched on.
 */
export async function testOdometerSyncConnection(): Promise<OdometerTestResult> {
  const auth = await requireService("service.manage");
  if ("error" in auth) return { error: "not_authorized" };

  const config = await reads.getOdometerSyncConfig();
  if (!/^https?:\/\//i.test(config.base_url)) return { error: "invalid_base_url" };
  // The credential comes from the server environment, never from the document.
  const appSecret = (process.env.SERVICE_ODOMETER_APP_SECRET ?? "").trim();
  if (!appSecret) return { error: "secret_missing" };

  const url = `${config.base_url}${config.vehicles_path.startsWith("/") ? "" : "/"}${config.vehicles_path}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        AppCid: config.app_cid,
        AppSecret: appSecret,
        "Content-Type": "application/json",
      },
      // The feed is a status check, not a data load: never hang a dialog on it.
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { error: "http_error", status: response.status, message: text.slice(0, 400) };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "not_json", status: response.status, message: text.slice(0, 400) };
    }
    const rows = asRecordRows(parsed);
    return {
      ok: true,
      status: response.status,
      sample: rows[0] ?? null,
      rows: rows.length,
    };
  } catch (error) {
    return { error: "request_failed", message: String(error).slice(0, 400) };
  }
}

/** The first array of objects anywhere in the payload — `data`, `rows`, `result`. */
function asRecordRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object",
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "rows", "result", "list", "items", "vehicles"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object",
      );
    }
    if (value && typeof value === "object") {
      const nested = asRecordRows(value);
      if (nested.length > 0) return nested;
    }
  }
  return [record];
}


