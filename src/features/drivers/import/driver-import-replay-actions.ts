"use server";

import { syncIntakeAssetAssignments } from "@/features/assets/assets-actions";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { DEFAULT_NOTIFY_LEAD_DAYS } from "@/features/drivers/types";
import { getFirebaseAuth } from "@/lib/firebase/admin";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { deleteDocumentTracking, upsertDocumentTracking } from "@/lib/storage/document-tracking";
import type { DriverDocumentType } from "@/features/drivers/types";
import { requireDriversManager } from "../drivers-import-actions";
import { staffClient } from "../driver-uniqueness";
import { syncImportRestaurants } from "./driver-import-write";
import {
  effectiveReplay,
  nextUndoSeq,
  redoRowPlan,
  redoTargetId,
  undoRowPlan,
  undoTargetId,
  type DriverImportBatchTip,
  type DriverImportJournal,
  type DriverImportSnapshot,
} from "./driver-import-stack";

function monthStart(): string {
  return `${kuwaitToday().slice(0, 7)}-01`;
}

function emailFor(driverCode: string): string {
  return `${driverCode.trim().toLowerCase()}@driver.dpd.local`;
}

function asJournal(row: Record<string, unknown>): DriverImportJournal {
  return {
    batch_id: String(row.batch_id ?? ""),
    row_index: Number(row.row_index ?? 0),
    outcome: (row.outcome as DriverImportJournal["outcome"]) ?? "failed",
    intake_id: (row.intake_id as string | null) ?? null,
    driver_id: (row.driver_id as string | null) ?? null,
    created_auth_uid: (row.created_auth_uid as string | null) ?? null,
    passcode: (row.passcode as string | null) ?? null,
    before: (row.before as DriverImportSnapshot | null) ?? null,
    after: (row.after as DriverImportSnapshot | null) ?? null,
    replay:
      row.replay === "applied" || row.replay === "undone" ? row.replay : null,
  };
}

async function loadTips(): Promise<DriverImportBatchTip[]> {
  const db = await staffClient();
  const { data } = await db
    .from("driver_import_batches")
    .select("id, status, created_at, undo_seq, redoable")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    status: String(row.status ?? ""),
    createdAt: String(row.created_at ?? ""),
    undoSeq: Number(row.undo_seq ?? 0),
    redoable: row.redoable !== false,
  }));
}

async function loadRows(batchId: string): Promise<DriverImportJournal[]> {
  const db = await staffClient();
  const { data } = await db.from("driver_import_rows").select("*").eq("batch_id", batchId);
  return (data ?? [])
    .map((row) => asJournal(row as Record<string, unknown>))
    .sort((a, b) => a.row_index - b.row_index);
}

async function writeSnapshot(
  snap: DriverImportSnapshot,
  intakeId: string,
  driverId: string | null,
): Promise<string | null> {
  const db = await staffClient();
  if (snap.intake) {
    const { error } = await db.from("driver_intakes").update(snap.intake).eq("id", intakeId);
    if (error) return error.message;
  }
  if (driverId && snap.driver) {
    const { error } = await db.from("drivers").update(snap.driver).eq("id", driverId);
    if (error) return error.message;
  }
  if (driverId && snap.profile) {
    const { error } = await db.from("profiles").update(snap.profile).eq("id", driverId);
    if (error) return error.message;
  }
  const restaurants = await syncImportRestaurants(db, intakeId, driverId, snap.restaurant_ids);
  if (restaurants) return restaurants;
  const assets = await syncIntakeAssetAssignments(null, intakeId, snap.asset_ids, "import-replay", driverId);
  if (assets.error) return assets.error;
  for (const item of snap.tracking) {
    const saved = await upsertDocumentTracking({
      intakeId,
      driverProfileId: driverId,
      docType: item.doc_type as DriverDocumentType,
      objectKey: item.object_key,
      expiry: {
        trackExpiry: item.track_expiry,
        expiresAt: item.expires_at,
        notifyEnabled: true,
        notifyLeadDays: [...DEFAULT_NOTIFY_LEAD_DAYS],
        objectKey: item.object_key,
      },
    });
    if (saved.error) return saved.error;
  }
  if (driverId) {
    if (snap.off_days == null) {
      await db
        .from("driver_off_structure")
        .delete()
        .eq("driver_id", driverId)
        .eq("period_month", monthStart());
    } else {
      const { error } = await db.rpc("admin_set_driver_off_structure", {
        p_driver_id: driverId,
        p_month: monthStart(),
        p_off_days: snap.off_days,
      });
      if (error) return error.message;
    }
  }
  return null;
}

async function deleteCreated(row: DriverImportJournal): Promise<string | null> {
  const db = await staffClient();
  const intakeId = row.intake_id;
  if (!intakeId) return null;
  const snap = row.after;
  for (const item of snap?.tracking ?? []) {
    await deleteDocumentTracking({
      intakeId,
      driverProfileId: row.driver_id,
      docType: item.doc_type as DriverDocumentType,
    });
  }
  await db.from("driver_intake_restaurants").delete().eq("intake_id", intakeId);
  if (row.driver_id) {
    await db.from("driver_restaurants").delete().eq("driver_id", row.driver_id);
  }
  await syncIntakeAssetAssignments(null, intakeId, [], "import-replay", row.driver_id);
  if (row.driver_id) {
    await db
      .from("driver_off_structure")
      .delete()
      .eq("driver_id", row.driver_id)
      .eq("period_month", monthStart());
    const driverGone = await db.from("drivers").delete().eq("id", row.driver_id);
    if (driverGone.error) return driverGone.error.message;
    const profileGone = await db.from("profiles").delete().eq("id", row.driver_id);
    if (profileGone.error) return profileGone.error.message;
  }
  if (row.created_auth_uid) {
    try {
      const auth = await getFirebaseAuth();
      await auth?.deleteUser(row.created_auth_uid);
    } catch {
      /* already gone */
    }
  }
  const intakeGone = await db.from("driver_intakes").delete().eq("id", intakeId);
  return intakeGone.error?.message ?? null;
}

async function rewriteCreated(row: DriverImportJournal): Promise<string | null> {
  const snap = row.after;
  const intakeId = row.intake_id;
  if (!snap?.intake || !intakeId) return "missing_snapshot";
  const db = await staffClient();
  if (row.created_auth_uid) {
    const code = snap.driver_code ?? "";
    try {
      const auth = await getFirebaseAuth();
      await auth?.createUser({
        uid: row.created_auth_uid,
        email: emailFor(code || row.created_auth_uid),
        emailVerified: true,
      });
    } catch {
      /* the login is already there */
    }
  }
  const { error } = await db.from("driver_intakes").insert(snap.intake);
  if (error) return error.message;
  if (row.driver_id && snap.driver) {
    const driver = await db.from("drivers").insert(snap.driver);
    if (driver.error) return driver.error.message;
  }
  if (row.driver_id && snap.profile) {
    const profile = await db.from("profiles").insert(snap.profile);
    if (profile.error) return profile.error.message;
  }
  return writeSnapshot(snap, intakeId, row.driver_id);
}

function withReplay(
  rows: DriverImportJournal[],
  indexes: number[],
  replay: "applied" | "undone",
): DriverImportJournal[] {
  const picked = new Set(indexes);
  return rows.map((row) => (picked.has(row.row_index) ? { ...row, replay } : row));
}

async function markReplay(batchId: string, indexes: number[], replay: "applied" | "undone") {
  const db = await staffClient();
  for (let i = 0; i < indexes.length; i += 30) {
    const slice = indexes.slice(i, i + 30);
    await db
      .from("driver_import_rows")
      .update({ replay })
      .eq("batch_id", batchId)
      .in("row_index", slice);
  }
}

async function syncBatchReplay(
  batchId: string,
  rows: DriverImportJournal[],
  viewed: "applied" | "undone",
) {
  const actionable = rows.filter((row) => undoRowPlan(row) || redoRowPlan(row));
  const allUndone =
    actionable.length === 0 ||
    actionable.every((row) => effectiveReplay(row.replay, viewed) === "undone");
  const allApplied = actionable.every(
    (row) => effectiveReplay(row.replay, viewed) === "applied",
  );
  const db = await staffClient();
  if (allUndone && viewed !== "undone") {
    await db
      .from("driver_import_batches")
      .update({ status: "undone", undo_seq: nextUndoSeq(await loadTips()), redoable: true })
      .eq("id", batchId);
  } else if (allApplied && viewed === "undone") {
    await db.from("driver_import_batches").update({ status: "applied" }).eq("id", batchId);
  }
}

async function applyUndo(row: DriverImportJournal): Promise<"skip" | "done" | { error: string }> {
  const plan = undoRowPlan(row);
  if (plan === "delete") {
    const error = await deleteCreated(row);
    return error ? { error } : "done";
  }
  if (plan === "restore") {
    if (!row.before || !row.intake_id) return { error: "missing_snapshot" };
    const error = await writeSnapshot(row.before, row.intake_id, row.driver_id);
    return error ? { error } : "done";
  }
  return "skip";
}

async function applyRedo(row: DriverImportJournal): Promise<"skip" | "done" | { error: string }> {
  const plan = redoRowPlan(row);
  if (!plan || !row.after || !row.intake_id) return "skip";
  const error =
    row.outcome === "create"
      ? await rewriteCreated(row)
      : await writeSnapshot(row.after, row.intake_id, row.driver_id);
  return error ? { error } : "done";
}

export async function undoDriverImport(): Promise<
  { success: true; count: number } | { error: string }
> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("edit");
  if (auth.error) return { error: auth.error };
  const tips = await loadTips();
  const target = undoTargetId(tips);
  if (!target) return { error: "nothing_to_undo" };
  const rows = await loadRows(target);
  const touched: number[] = [];
  for (const row of rows) {
    if (effectiveReplay(row.replay, "applied") === "undone") continue;
    const result = await applyUndo(row);
    if (typeof result === "object") return result;
    if (result === "done") touched.push(row.row_index);
  }
  if (touched.length > 0) await markReplay(target, touched, "undone");
  await syncBatchReplay(target, withReplay(rows, touched, "undone"), "applied");
  return { success: true, count: touched.length };
}

export async function redoDriverImport(): Promise<
  { success: true; count: number } | { error: string }
> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("edit");
  if (auth.error) return { error: auth.error };
  const tips = await loadTips();
  const target = redoTargetId(tips);
  if (!target) return { error: "nothing_to_redo" };
  const rows = await loadRows(target);
  const touched: number[] = [];
  for (const row of rows) {
    if (effectiveReplay(row.replay, "undone") === "applied") continue;
    const result = await applyRedo(row);
    if (typeof result === "object") return result;
    if (result === "done") touched.push(row.row_index);
  }
  if (touched.length > 0) await markReplay(target, touched, "applied");
  await syncBatchReplay(target, withReplay(rows, touched, "applied"), "undone");
  return { success: true, count: touched.length };
}

async function replaySelected(
  batchId: string,
  rowIndexes: number[],
  direction: "undo" | "redo",
): Promise<{ success: true; count: number } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("edit");
  if (auth.error) return { error: auth.error };
  const tips = await loadTips();
  const viewed = tips.find((tip) => tip.id === batchId);
  const status: "applied" | "undone" = viewed?.status === "undone" ? "undone" : "applied";
  const wanted = new Set(rowIndexes);
  const rows = (await loadRows(batchId)).filter((row) => wanted.has(row.row_index));
  const touched: number[] = [];
  for (const row of rows) {
    if (direction === "undo") {
      if (effectiveReplay(row.replay, status) === "undone") continue;
      const result = await applyUndo(row);
      if (typeof result === "object") return result;
      if (result === "done") touched.push(row.row_index);
    } else {
      if (effectiveReplay(row.replay, status) === "applied") continue;
      const result = await applyRedo(row);
      if (typeof result === "object") return result;
      if (result === "done") touched.push(row.row_index);
    }
  }
  if (touched.length === 0) {
    return { error: direction === "undo" ? "nothing_to_undo" : "nothing_to_redo" };
  }
  const next = direction === "undo" ? "undone" : "applied";
  await markReplay(batchId, touched, next);
  await syncBatchReplay(batchId, withReplay(await loadRows(batchId), touched, next), status);
  return { success: true, count: touched.length };
}

export async function undoDriverImportRows(
  batchId: string,
  rowIndexes: number[],
): Promise<{ success: true; count: number } | { error: string }> {
  return replaySelected(batchId, rowIndexes, "undo");
}

export async function redoDriverImportRows(
  batchId: string,
  rowIndexes: number[],
): Promise<{ success: true; count: number } | { error: string }> {
  return replaySelected(batchId, rowIndexes, "redo");
}

export type DriverImportJournalLine = {
  rowIndex: number;
  outcome: DriverImportJournal["outcome"];
  intakeId: string | null;
  driverId: string | null;
  replay: "applied" | "undone";
  name: string;
  employeeId: string;
};

function snapIdentity(snap: DriverImportSnapshot | null): { name: string; employeeId: string } {
  const intake = snap?.intake;
  const name = typeof intake?.full_name === "string" ? intake.full_name : "";
  const employeeId = typeof intake?.employee_id === "string" ? intake.employee_id : "";
  return { name, employeeId };
}

export async function listDriverImportJournal(batchId: string): Promise<DriverImportJournalLine[]> {
  const auth = await requireDriversManager("edit");
  if (auth.error) return [];
  const db = await staffClient();
  const batch = await db
    .from("driver_import_batches")
    .select("status")
    .eq("id", batchId)
    .maybeSingle();
  const status = String(batch.data?.status ?? "applied");
  const rows = await loadRows(batchId);
  return rows.map((row) => {
    const after = snapIdentity(row.after);
    const before = snapIdentity(row.before);
    return {
      rowIndex: row.row_index,
      outcome: row.outcome,
      intakeId: row.intake_id,
      driverId: row.driver_id,
      replay: effectiveReplay(row.replay, status),
      name: after.name || before.name,
      employeeId: after.employeeId || before.employeeId,
    };
  });
}
