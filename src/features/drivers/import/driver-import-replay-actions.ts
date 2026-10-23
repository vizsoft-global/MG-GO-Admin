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

export async function undoDriverImport(): Promise<{ success: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("edit");
  if (auth.error) return { error: auth.error };
  const tips = await loadTips();
  const target = undoTargetId(tips);
  if (!target) return { error: "nothing_to_undo" };
  const rows = await loadRows(target);
  for (const row of rows) {
    const plan = undoRowPlan(row);
    if (plan === "delete") {
      const error = await deleteCreated(row);
      if (error) return { error };
    } else if (plan === "restore") {
      if (!row.before || !row.intake_id) return { error: "missing_snapshot" };
      const error = await writeSnapshot(row.before, row.intake_id, row.driver_id);
      if (error) return { error };
    }
  }
  const db = await staffClient();
  await db
    .from("driver_import_batches")
    .update({ status: "undone", undo_seq: nextUndoSeq(tips), redoable: true })
    .eq("id", target);
  return { success: true };
}

export async function redoDriverImport(): Promise<{ success: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("edit");
  if (auth.error) return { error: auth.error };
  const tips = await loadTips();
  const target = redoTargetId(tips);
  if (!target) return { error: "nothing_to_redo" };
  const rows = await loadRows(target);
  for (const row of rows) {
    const plan = redoRowPlan(row);
    if (!plan || !row.after || !row.intake_id) continue;
    const error =
      row.outcome === "create"
        ? await rewriteCreated(row)
        : await writeSnapshot(row.after, row.intake_id, row.driver_id);
    if (error) return { error };
  }
  const db = await staffClient();
  await db.from("driver_import_batches").update({ status: "applied" }).eq("id", target);
  return { success: true };
}
