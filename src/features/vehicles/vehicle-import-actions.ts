"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { Json } from "@/types/database";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import {
  previewVehicleImport,
  type VehicleImportExisting,
  type VehicleImportPreviewRow,
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
const MAX_ROWS = 1000;

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

async function requireCreate() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "vehicles.create", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
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
  };
}

function fromVehicle(row: Row): VehicleImportExisting {
  return asSnapshot({
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
    fuel_monthly_limit_kwd: row.fuel_monthly_limit_kwd == null ? null : Number(row.fuel_monthly_limit_kwd),
  });
}

function writePayload(snapshot: VehicleSheetSnapshot) {
  return {
    ...snapshot,
    project_type: snapshot.project_type,
    status: snapshot.status,
    updated_at: new Date().toISOString(),
  };
}

export type VehicleImportBatchesResult =
  | { ok: true; batches: VehicleImportBatchRow[] }
  | { ok: false; error: string };

export async function listVehicleImportBatches(): Promise<VehicleImportBatchesResult> {
  const auth = await requireCreate();
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
  const auth = await requireCreate();
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
  const auth = await requireCreate();
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
  try {
    const [vehicles, uses] = await Promise.all([
      db.collection(COLLECTIONS.vehicles).get(),
      db.collection(COLLECTIONS.vehicleUseTypes).where("is_active", "==", true).get(),
    ]);
    existing = vehicles.docs.map((doc) => fromVehicle(asRow(doc.id, doc.data())));
    allowedUseTypes = uses.docs.map((doc) => str(doc.data().key) || doc.id).filter(Boolean);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  const preview = previewVehicleImport({
    headers: input.headers,
    rows: input.rows,
    existing,
    allowedUseTypes,
  });
  if (preview.error) return { error: preview.error };
  if (!preview.rows.length) return { error: "empty_sheet" };

  const logged: Array<{
    row: VehicleImportPreviewRow;
    outcome: "create" | "update" | "failed";
    message: string | null;
    vehicleId: string | null;
  }> = [];

  for (const row of preview.rows) {
    if (row.status === "error" || !row.after) {
      logged.push({ row, outcome: "failed", message: row.error, vehicleId: row.vehicleId });
      continue;
    }
    if (row.status === "create") {
      const id = crypto.randomUUID();
      try {
        await db.collection(COLLECTIONS.vehicles).doc(id).set({
          id,
          ...writePayload(row.after),
          created_by: auth.session.id,
          created_at: new Date(),
        });
        logged.push({ row, outcome: "create", message: null, vehicleId: id });
      } catch (error) {
        logged.push({
          row,
          outcome: "failed",
          message: error instanceof Error ? error.message : "save_failed",
          vehicleId: null,
        });
      }
      continue;
    }
    try {
      await db
        .collection(COLLECTIONS.vehicles)
        .doc(row.vehicleId ?? "")
        .set(writePayload(row.after), { merge: true });
      logged.push({ row, outcome: "update", message: null, vehicleId: row.vehicleId });
    } catch (error) {
      logged.push({
        row,
        outcome: "failed",
        message: error instanceof Error ? error.message : "save_failed",
        vehicleId: row.vehicleId,
      });
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

export async function undoVehicleImport(): Promise<{ error?: string; changed?: number }> {
  return replay("undo");
}

export async function redoVehicleImport(): Promise<{ error?: string; changed?: number }> {
  return replay("redo");
}

async function replay(direction: "undo" | "redo"): Promise<{ error?: string; changed?: number }> {
  const auth = await requireCreate();
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
    if (direction === "undo") {
      const plan = undoRowPlan({ outcome, vehicleId, before: row.before });
      if (!plan) continue;
      try {
        if (plan.op === "delete") {
          await db.collection(COLLECTIONS.vehicles).doc(plan.vehicleId).delete();
        } else {
          const snapshot = plan.snapshot as VehicleSheetSnapshot;
          await db
            .collection(COLLECTIONS.vehicles)
            .doc(plan.vehicleId)
            .set(writePayload(snapshot), { merge: true });
        }
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
