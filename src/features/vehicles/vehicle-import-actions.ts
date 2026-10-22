"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { COLLECTIONS, UNIQ_COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { Json } from "@/types/database";
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import {
  previewVehicleImport,
  type VehicleCompanyRef,
  type VehicleDriverRef,
  type VehicleImportExisting,
  type VehicleImportPreviewRow,
  type VehiclePartnerRef,
  type VehicleSheetSnapshot,
} from "./import/vehicle-import-preview";
import {
  nextUndoSeq,
  redoRowPlan,
  redoTargetId,
  undoRowPlan,
  undoTargetId,
  type VehicleImportBatchTip,
} from "./import/vehicle-import-stack";

const BATCHES = "vehicle_import_batches";
const IMPORT_ROWS = "vehicle_import_rows";
/** A sheet may hold up to 2000 vehicle rows; writes are batched 400 at a time. */
const MAX_ROWS = 2000;
const WRITE_CHUNK = 400;

export type VehicleImportBatchRow = {
  id: string;
  fileName: string;
  status: "applied" | "undone";
  totalRows: number;
  appliedRows: number;
  failedRows: number;
  createdAt: string;
  undoSeq: number | null;
  redoable: boolean;
};

export type VehicleImportLogRow = {
  rowIndex: number;
  bikeId: string;
  outcome: "create" | "update" | "failed";
  message: string | null;
};

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

/**
 * Writes rider assignment + document dates as well as the vehicle row, so the
 * gate is `vehicles.manage` — not `vehicles.create`.
 */
async function requireManage() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "vehicles.manage", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

/** Claims the plate in `uniq_plate`; `false` means another vehicle owns it. */
async function claimPlate(db: Firestore, plate: string, ownerId: string): Promise<boolean> {
  const ref = db.collection(UNIQ_COLLECTIONS.plate).doc(encodeURIComponent(plate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const owner = snap.exists ? str(snap.data()?.owner_id) : "";
    if (snap.exists && owner && owner !== ownerId) return false;
    tx.set(ref, { owner_id: ownerId });
    return true;
  });
}

async function releasePlate(db: Firestore, plate: string, ownerId: string) {
  const ref = db.collection(UNIQ_COLLECTIONS.plate).doc(encodeURIComponent(plate));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && str(snap.data()?.owner_id) === ownerId) tx.delete(ref);
  });
}

/**
 * Identity check against the snapshot this import already loaded. A plate that
 * another vehicle holds is never re-created; the cross-session race is covered
 * by the `uniq_plate` claim, so the loop stays query-free for 2000-row sheets.
 */
function identityTaken(
  existing: readonly VehicleImportExisting[],
  regNumber: string,
  bikeId: string,
  exceptId: string,
): "duplicate_plate" | "duplicate_bike_id" | null {
  if (existing.some((row) => row.id !== exceptId && row.reg_number === regNumber)) {
    return "duplicate_plate";
  }
  if (existing.some((row) => row.id !== exceptId && row.bike_id === bikeId)) {
    return "duplicate_bike_id";
  }
  return null;
}

function asSnapshot(row: {
  id: string;
  bike_id: string;
  reg_number: string | null;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  vehicle_type_key: string;
  project_type: string;
  status: string;
  location_text: string | null;
  condition: string | null;
  car_type: string | null;
  type_of_use: string | null;
  fuel_type: string | null;
  fuel_company: string | null;
  chip_no: string | null;
  fuel_monthly_limit_kwd: number | null;
  company_id?: string | null;
  owner_partner_id?: string | null;
  registration_issued_at?: string | null;
  registration_expires_at?: string | null;
  insurance_issued_at?: string | null;
  insurance_expires_at?: string | null;
  replaces_vehicle_id?: string | null;
  replacement_started_at?: string | null;
}): VehicleImportExisting {
  return {
    id: row.id,
    bike_id: row.bike_id,
    reg_number: row.reg_number,
    chassis_no: row.chassis_no,
    make: row.make,
    model: row.model,
    model_year: row.model_year,
    vehicle_type_key: row.vehicle_type_key,
    project_type: row.project_type === "rent" ? "rent" : "group",
    status:
      row.status === "suspended" || row.status === "maintenance" ? row.status : "active",
    location_text: row.location_text,
    condition: row.condition,
    car_type: row.car_type,
    type_of_use: row.type_of_use,
    fuel_type: row.fuel_type,
    fuel_company: row.fuel_company,
    chip_no: row.chip_no,
    fuel_monthly_limit_kwd: row.fuel_monthly_limit_kwd,
    company_id: row.company_id ?? null,
    owner_partner_id: row.owner_partner_id ?? null,
    registration_issued_at: row.registration_issued_at ?? null,
    registration_expires_at: row.registration_expires_at ?? null,
    insurance_issued_at: row.insurance_issued_at ?? null,
    insurance_expires_at: row.insurance_expires_at ?? null,
    replaces_vehicle_id: row.replaces_vehicle_id ?? null,
    replacement_started_at: row.replacement_started_at ?? null,
  };
}

function fromVehicle(row: Row, assignedDriverId: string | null = null): VehicleImportExisting {
  return {
    ...asSnapshot({
      id: row.id,
      bike_id: str(row.bike_id),
      reg_number: str(row.reg_number) || null,
      chassis_no: str(row.chassis_no) || null,
      make: str(row.make) || null,
      model: str(row.model) || null,
      model_year: row.model_year == null ? null : Number(row.model_year),
      vehicle_type_key: str(row.vehicle_type_key),
      project_type: str(row.project_type),
      status: str(row.status),
      location_text: str(row.location_text) || null,
      condition: str(row.condition) || null,
      car_type: str(row.car_type) || null,
      type_of_use: str(row.type_of_use) || null,
      fuel_type: str(row.fuel_type) || null,
      fuel_company: str(row.fuel_company) || null,
      chip_no: str(row.chip_no) || null,
      fuel_monthly_limit_kwd:
        row.fuel_monthly_limit_kwd == null ? null : Number(row.fuel_monthly_limit_kwd),
      company_id: str(row.company_id) || null,
      owner_partner_id: str(row.owner_partner_id) || null,
      registration_issued_at: str(row.registration_issued_at) || null,
      registration_expires_at: str(row.registration_expires_at) || null,
      insurance_issued_at: str(row.insurance_issued_at) || null,
      insurance_expires_at: str(row.insurance_expires_at) || null,
      replaces_vehicle_id: str(row.replaces_vehicle_id) || null,
      replacement_started_at: str(row.replacement_started_at) || null,
    }),
    assigned_driver_id: assignedDriverId,
  };
}

function writePayload(snapshot: VehicleSheetSnapshot) {
  return {
    ...snapshot,
    updated_at: new Date().toISOString(),
  };
}

/** Only the fields that actually changed — a blank cell never rewrites a column. */
function changedPayload(
  before: VehicleSheetSnapshot | null,
  after: VehicleSheetSnapshot,
): Record<string, unknown> {
  if (!before) return writePayload(after);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof VehicleSheetSnapshot)[]) {
    if (before[key] === after[key]) continue;
    patch[key] = after[key];
  }
  if (Object.keys(patch).length === 0) return {};
  return { ...patch, updated_at: new Date().toISOString() };
}

export type VehicleImportBatchesResult =
  | { ok: true; batches: VehicleImportBatchRow[] }
  | { ok: false; error: string };

export async function listVehicleImportBatches(): Promise<VehicleImportBatchesResult> {
  const auth = await requireManage();
  if ("error" in auth) return { ok: false, error: auth.error ?? "not_authorized" };
  try {
    const db = await openDb();
    const snap = await db.collection(BATCHES).orderBy("created_at", "desc").limit(50).get();
    return {
      ok: true,
      batches: snap.docs.map((doc) => {
        const row = asRow(doc.id, doc.data());
        return {
          id: row.id,
          fileName: str(row.file_name),
          status: row.status === "undone" ? "undone" : "applied",
          totalRows: Number(row.total_rows ?? 0),
          appliedRows: Number(row.applied_rows ?? 0),
          failedRows: Number(row.failed_rows ?? 0),
          createdAt: str(row.created_at),
          undoSeq: row.undo_seq == null ? null : Number(row.undo_seq),
          redoable: row.redoable === true,
        };
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "save_failed" };
  }
}

export async function listVehicleImportRows(batchId: string): Promise<VehicleImportLogRow[]> {
  const auth = await requireManage();
  if ("error" in auth) return [];
  try {
    const db = await openDb();
    const snap = await db.collection(IMPORT_ROWS).where("batch_id", "==", batchId).get();
    return snap.docs
      .map((doc) => asRow(doc.id, doc.data()))
      .sort((a, b) => Number(a.row_index ?? 0) - Number(b.row_index ?? 0))
      .map((row) => ({
        rowIndex: Number(row.row_index ?? 0),
        bikeId: str(row.bike_id),
        outcome: row.outcome === "create" || row.outcome === "update" ? row.outcome : "failed",
        message: str(row.message) || null,
      }));
  } catch {
    return [];
  }
}

export async function applyVehicleImport(input: {
  fileName: string;
  headers: string[];
  rows: string[][];
}): Promise<{ error?: string; applied?: number; failed?: number }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireManage();
  if ("error" in auth) return { error: auth.error };
  if (input.rows.length > MAX_ROWS) return { error: "too_many_rows" };

  let db: Firestore;
  try {
    db = await openDb();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "not_configured" };
  }

  let existing: VehicleImportExisting[];
  let allowedUseTypes: string[];
  let drivers: VehicleDriverRef[];
  let companies: VehicleCompanyRef[];
  let partners: VehiclePartnerRef[];
  const driversByVehicle = new Map<string, string[]>();
  try {
    const [vehicles, uses, driverSnap, companySnap, partnerSnap] = await Promise.all([
      db.collection(COLLECTIONS.vehicles).get(),
      db.collection(COLLECTIONS.vehicleUseTypes).where("is_active", "==", true).get(),
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      db.collection(COLLECTIONS.vehicleCompanies).get(),
      db.collection(COLLECTIONS.partners).get(),
    ]);
    drivers = driverSnap.docs
      .map((doc) => ({ id: doc.id, employee_id: str(doc.data().employee_id) }))
      .filter((driver) => driver.employee_id);
    for (const doc of driverSnap.docs) {
      const vehicleId = str(doc.data().vehicle_id);
      if (!vehicleId) continue;
      const list = driversByVehicle.get(vehicleId);
      if (list) list.push(doc.id);
      else driversByVehicle.set(vehicleId, [doc.id]);
    }
    existing = vehicles.docs.map((doc) =>
      fromVehicle(asRow(doc.id, doc.data()), driversByVehicle.get(doc.id)?.[0] ?? null),
    );
    allowedUseTypes = uses.docs.map((doc) => str(doc.data().key) || doc.id).filter(Boolean);
    companies = companySnap.docs.map((doc) => {
      const row = asRow(doc.id, doc.data());
      return {
        key: str(row.key) || doc.id,
        label_en: str(row.label_en),
        label_ar: str(row.label_ar),
      };
    });
    partners = partnerSnap.docs.map((doc) => {
      const row = asRow(doc.id, doc.data());
      return { id: doc.id, name: str(row.name) };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  const preview = previewVehicleImport({
    headers: input.headers,
    rows: input.rows,
    existing,
    allowedUseTypes,
    drivers,
    companies,
    partners,
  });
  if (preview.error) return { error: preview.error };
  if (!preview.rows.length) return { error: "empty_sheet" };

  const logged: Array<{
    row: VehicleImportPreviewRow;
    outcome: "create" | "update" | "failed";
    message: string | null;
    vehicleId: string | null;
    driverBefore: string | null;
    driverAfter: string | null;
  }> = [];

  const pending: Array<{ ref: DocumentReference; patch: Record<string, unknown> }> = [];
  const flush = async () => {
    for (let i = 0; i < pending.length; i += WRITE_CHUNK) {
      const slice = db.batch();
      for (const write of pending.slice(i, i + WRITE_CHUNK)) {
        slice.set(write.ref, write.patch, { merge: true });
      }
      await slice.commit();
    }
    pending.length = 0;
  };
  const queueDriver = (driverId: string, vehicleId: string | null) => {
    pending.push({
      ref: db.collection(COLLECTIONS.drivers).doc(driverId),
      patch: { vehicle_id: vehicleId, updated_at: new Date() },
    });
  };
  const queueIntakes = async (driverId: string, vehicleId: string | null) => {
    const snap = await db
      .collection(COLLECTIONS.driverIntakes)
      .where("linked_profile_id", "==", driverId)
      .where("archived_at", "==", null)
      .get();
    for (const doc of snap.docs) {
      pending.push({ ref: doc.ref, patch: { vehicle_id: vehicleId, updated_at: new Date() } });
    }
  };

  for (const row of preview.rows) {
    const driverAfter =
      row.driverAction === "assign"
        ? row.driverId
        : row.driverAction === "clear"
          ? null
          : row.driverBefore;
    if (row.status === "error" || !row.after) {
      logged.push({
        row,
        outcome: "failed",
        message: row.error,
        vehicleId: row.vehicleId,
        driverBefore: row.driverBefore,
        driverAfter: row.driverBefore,
      });
      continue;
    }
    const snapshot = row.after;
    try {
      if (row.status === "create") {
        const id = crypto.randomUUID();
        const taken = identityTaken(existing, snapshot.reg_number ?? "", snapshot.bike_id, id);
        if (taken) throw new Error(taken);
        if (snapshot.reg_number) {
          const claimed = await claimPlate(db, snapshot.reg_number, id);
          if (!claimed) throw new Error("duplicate_plate");
        }
        try {
          await db
            .collection(COLLECTIONS.vehicles)
            .doc(id)
            .set({
              id,
              ...writePayload(snapshot),
              created_by: auth.session.id,
              created_at: new Date(),
            });
        } catch (error) {
          // Do not leave a plate claimed by a vehicle that was never written.
          if (snapshot.reg_number) {
            await releasePlate(db, snapshot.reg_number, id).catch(() => undefined);
          }
          throw error;
        }
        logged.push({
          row,
          outcome: "create",
          message: null,
          vehicleId: id,
          driverBefore: null,
          driverAfter,
        });
        if (driverAfter) {
          queueDriver(driverAfter, id);
          await queueIntakes(driverAfter, id);
        }
      } else {
        const vehicleId = row.vehicleId ?? "";
        if (!vehicleId) throw new Error("missing_fields");
        const patch = changedPayload(row.before, snapshot);
        if (Object.keys(patch).length > 0) {
          await db.collection(COLLECTIONS.vehicles).doc(vehicleId).set(patch, { merge: true });
        }
        logged.push({
          row,
          outcome: "update",
          message: null,
          vehicleId,
          driverBefore: row.driverBefore,
          driverAfter,
        });
        if (driverAfter !== row.driverBefore) {
          for (const holder of driversByVehicle.get(vehicleId) ?? []) {
            if (holder !== driverAfter) queueDriver(holder, null);
          }
          if (row.driverBefore && row.driverBefore !== driverAfter) {
            queueDriver(row.driverBefore, null);
            await queueIntakes(row.driverBefore, null);
          }
          if (driverAfter) {
            queueDriver(driverAfter, vehicleId);
            await queueIntakes(driverAfter, vehicleId);
          }
        }
      }
      if (pending.length >= WRITE_CHUNK) await flush();
    } catch (error) {
      logged.push({
        row,
        outcome: "failed",
        message: error instanceof Error ? error.message : "save_failed",
        vehicleId: row.vehicleId,
        driverBefore: row.driverBefore,
        driverAfter: row.driverBefore,
      });
    }
  }

  if (pending.length > 0) {
    try {
      await flush();
    } catch (error) {
      const appliedNow = logged.filter((item) => item.outcome !== "failed").length;
      return {
        error: error instanceof Error ? error.message : "save_failed",
        applied: appliedNow,
        failed: logged.length - appliedNow,
      };
    }
  }

  const applied = logged.filter((item) => item.outcome !== "failed").length;
  const failed = logged.length - applied;
  const batchId = crypto.randomUUID();
  try {
    await db.collection(BATCHES).doc(batchId).set({
      id: batchId,
      file_name: input.fileName.slice(0, 180) || "vehicles.xlsx",
      status: "applied",
      total_rows: logged.length,
      applied_rows: applied,
      failed_rows: failed,
      uploaded_by: auth.session.id,
      created_at: new Date(),
      redoable: false,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed", applied, failed };
  }

  try {
    for (let i = 0; i < logged.length; i += 400) {
      const slice = db.batch();
      for (const item of logged.slice(i, i + 400)) {
        const id = crypto.randomUUID();
        slice.set(db.collection(IMPORT_ROWS).doc(id), {
          id,
          batch_id: batchId,
          row_index: item.row.rowIndex,
          bike_id: item.row.bikeId,
          outcome: item.outcome,
          message: item.message,
          vehicle_id: item.vehicleId,
          driver_before: item.driverBefore,
          driver_after: item.driverAfter,
          cleared_fields: item.row.clearedFields as Json,
          before: (item.row.before ?? null) as Json,
          after: (item.outcome === "failed" ? null : item.row.after) as Json,
          created_at: new Date(),
        });
      }
      await slice.commit();
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed", applied, failed };
  }

  const undone = await db.collection(BATCHES).where("status", "==", "undone").get();
  await Promise.all(
    undone.docs
      .filter((doc) => doc.id !== batchId)
      .map((doc) => doc.ref.set({ redoable: false }, { merge: true })),
  );

  void logAdminMutation({
    action: "create",
    entityType: "vehicle_import",
    entityId: batchId,
    routeName: "/vehicles",
    after: { applied, failed, fileName: input.fileName },
  });
  return { applied, failed };
}

/**
 * Puts the rider back (undo) or forward (redo) on one vehicle. `clearId` only
 * leaves the vehicle when it still points here, so a newer manual assignment is
 * never clobbered by an old batch.
 */
async function syncAssignment(
  db: Firestore,
  vehicleId: string,
  targetId: string | null,
  clearId: string | null,
) {
  const now = new Date();
  if (clearId && clearId !== targetId) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(clearId).get();
    if (snap.exists && str(snap.data()?.vehicle_id) === vehicleId) {
      await snap.ref.set({ vehicle_id: null, updated_at: now }, { merge: true });
    }
  }
  if (!targetId) return;
  await db
    .collection(COLLECTIONS.drivers)
    .doc(targetId)
    .set({ vehicle_id: vehicleId, updated_at: now }, { merge: true });
  const intakes = await db
    .collection(COLLECTIONS.driverIntakes)
    .where("linked_profile_id", "==", targetId)
    .where("archived_at", "==", null)
    .get();
  if (intakes.size === 0) return;
  const batch = db.batch();
  for (const doc of intakes.docs) {
    batch.set(doc.ref, { vehicle_id: vehicleId, updated_at: now }, { merge: true });
  }
  await batch.commit();
}

export async function undoVehicleImport(): Promise<{ error?: string; changed?: number }> {
  return replay("undo");
}

export async function redoVehicleImport(): Promise<{ error?: string; changed?: number }> {
  return replay("redo");
}

async function replay(direction: "undo" | "redo"): Promise<{ error?: string; changed?: number }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireManage();
  if ("error" in auth) return { error: auth.error };
  let db: Firestore;
  try {
    db = await openDb();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "not_configured" };
  }

  let tips: VehicleImportBatchTip[];
  try {
    const snap = await db.collection(BATCHES).orderBy("created_at", "desc").limit(50).get();
    tips = snap.docs.map((doc) => {
      const row = asRow(doc.id, doc.data());
      return {
        id: row.id,
        status: row.status === "undone" ? "undone" : "applied",
        createdAt: str(row.created_at),
        undoSeq: row.undo_seq == null ? null : Number(row.undo_seq),
        redoable: row.redoable === true,
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  const target = direction === "undo" ? undoTargetId(tips) : redoTargetId(tips);
  if (!target) return { error: direction === "undo" ? "nothing_to_undo" : "nothing_to_redo" };

  let rows: Row[];
  try {
    const snap = await db.collection(IMPORT_ROWS).where("batch_id", "==", target).get();
    rows = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  let changed = 0;
  for (const row of rows) {
    const outcome = row.outcome === "create" || row.outcome === "update" ? row.outcome : "failed";
    const vehicleId = str(row.vehicle_id) || null;
    const driverBefore = str(row.driver_before) || null;
    const driverAfter = str(row.driver_after) || null;
    if (direction === "undo") {
      const plan = undoRowPlan({ outcome, vehicleId, before: row.before });
      if (!plan) continue;
      try {
        if (plan.op === "delete") {
          await db.collection(COLLECTIONS.vehicles).doc(plan.vehicleId).delete();
          const plate = str((row.after as Record<string, unknown> | null)?.reg_number);
          if (plate) await releasePlate(db, plate, plan.vehicleId).catch(() => undefined);
        } else {
          const snapshot = plan.snapshot as VehicleSheetSnapshot;
          await db
            .collection(COLLECTIONS.vehicles)
            .doc(plan.vehicleId)
            .set(writePayload(snapshot), { merge: true });
        }
        await syncAssignment(db, plan.vehicleId, driverBefore, driverAfter);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "save_failed" };
      }
      changed += 1;
    } else {
      const plan = redoRowPlan({ outcome, vehicleId, after: row.after });
      if (!plan) continue;
      const snapshot = plan.snapshot as VehicleSheetSnapshot;
      try {
        if (plan.vehicleId) {
          const found = await db.collection(COLLECTIONS.vehicles).doc(plan.vehicleId).get();
          if (found.exists) {
            await found.ref.set(writePayload(snapshot), { merge: true });
            await syncAssignment(db, plan.vehicleId, driverAfter, driverBefore);
            changed += 1;
            continue;
          }
        }
        const id = plan.vehicleId || crypto.randomUUID();
        await db.collection(COLLECTIONS.vehicles).doc(id).set({
          id,
          ...writePayload(snapshot),
          created_by: auth.session.id,
          created_at: new Date(),
        });
        if (snapshot.reg_number) {
          await claimPlate(db, snapshot.reg_number, id).catch(() => undefined);
        }
        await syncAssignment(db, id, driverAfter, driverBefore);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "save_failed" };
      }
      changed += 1;
    }
  }

  try {
    if (direction === "undo") {
      await db.collection(BATCHES).doc(target).set(
        {
          status: "undone",
          undone_at: new Date().toISOString(),
          undo_seq: nextUndoSeq(tips),
          redoable: true,
        },
        { merge: true },
      );
    } else {
      await db.collection(BATCHES).doc(target).set(
        { status: "applied", undone_at: null, redoable: true },
        { merge: true },
      );
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_import",
    entityId: target,
    routeName: "/vehicles",
    after: { direction, changed },
  });
  return { changed };
}
