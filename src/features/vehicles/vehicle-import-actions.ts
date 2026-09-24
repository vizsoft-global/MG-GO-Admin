"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import {
  previewVehicleImport,
  type VehicleImportExisting,
  type VehicleImportPreviewRow,
  type VehicleSheetSnapshot,
} from "./import/vehicle-import-preview";
import { headerToField } from "./import/vehicle-import-columns";
import {
  nextUndoSeq,
  redoRowPlan,
  redoTargetId,
  undoRowPlan,
  undoTargetId,
  type VehicleImportBatchTip,
} from "./import/vehicle-import-stack";

const VEHICLE_COLUMNS =
  "id, bike_id, reg_number, chassis_no, make, model, model_year, vehicle_type_key, project_type, status, location_text, condition, car_type, type_of_use, fuel_type, fuel_company, chip_no, fuel_monthly_limit_kwd";

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

function writePayload(snapshot: VehicleSheetSnapshot) {
  return {
    ...snapshot,
    project_type: snapshot.project_type,
    status: snapshot.status,
    updated_at: new Date().toISOString(),
  };
}

export async function listVehicleImportBatches(): Promise<VehicleImportBatchRow[]> {
  const auth = await requireCreate();
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_import_batches")
    .select(
      "id, file_name, status, total_rows, applied_rows, failed_rows, created_at, undo_seq, redoable",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    status: row.status === "undone" ? "undone" : "applied",
    totalRows: row.total_rows,
    appliedRows: row.applied_rows,
    failedRows: row.failed_rows,
    createdAt: row.created_at,
    undoSeq: row.undo_seq,
    redoable: row.redoable,
  }));
}

export async function listVehicleImportRows(batchId: string): Promise<VehicleImportLogRow[]> {
  const auth = await requireCreate();
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_import_rows")
    .select("row_index, bike_id, outcome, message")
    .eq("batch_id", batchId)
    .order("row_index");
  if (error) return [];
  return (data ?? []).map((row) => ({
    rowIndex: row.row_index,
    bikeId: row.bike_id,
    outcome: row.outcome === "create" || row.outcome === "update" ? row.outcome : "failed",
    message: row.message,
  }));
}

export async function applyVehicleImport(input: {
  fileName: string;
  headers: string[];
  rows: string[][];
}): Promise<{ error?: string; applied?: number; failed?: number }> {
  const auth = await requireCreate();
  if ("error" in auth) return { error: auth.error };
  if (input.rows.length > MAX_ROWS) return { error: "too_many_rows" };

  const supabase = await createClient();
  const bikeHeader = input.headers.findIndex((header) => headerToField(header) === "bikeId");
  const bikeIds = [
    ...new Set(
      input.rows
        .map((row) => (bikeHeader >= 0 ? (row[bikeHeader] ?? "").trim() : ""))
        .filter(Boolean),
    ),
  ];
  const existing: VehicleImportExisting[] = [];
  for (let i = 0; i < bikeIds.length; i += 200) {
    const slice = bikeIds.slice(i, i + 200);
    const { data, error } = await supabase.from("vehicles").select(VEHICLE_COLUMNS).in("bike_id", slice);
    if (error) return { error: error.message };
    existing.push(...(data ?? []).map((row) => asSnapshot(row)));
  }

  const preview = previewVehicleImport({
    headers: input.headers,
    rows: input.rows,
    existing,
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
      logged.push({
        row,
        outcome: "failed",
        message: row.error,
        vehicleId: row.vehicleId,
      });
      continue;
    }
    if (row.status === "create") {
      const { data, error } = await supabase
        .from("vehicles")
        .insert({ ...writePayload(row.after), created_by: auth.session.id })
        .select("id")
        .single();
      logged.push({
        row,
        outcome: error ? "failed" : "create",
        message: error?.message ?? null,
        vehicleId: data?.id ?? null,
      });
      continue;
    }
    const { error } = await supabase
      .from("vehicles")
      .update(writePayload(row.after))
      .eq("id", row.vehicleId ?? "");
    logged.push({
      row,
      outcome: error ? "failed" : "update",
      message: error?.message ?? null,
      vehicleId: row.vehicleId,
    });
  }

  const applied = logged.filter((item) => item.outcome !== "failed").length;
  const failed = logged.length - applied;
  const { data: batch, error: batchError } = await supabase
    .from("vehicle_import_batches")
    .insert({
      file_name: input.fileName.slice(0, 180) || "vehicles.xlsx",
      status: "applied",
      total_rows: logged.length,
      applied_rows: applied,
      failed_rows: failed,
      uploaded_by: auth.session.id,
    })
    .select("id")
    .single();
  if (batchError || !batch) return { error: batchError?.message ?? "save_failed", applied, failed };

  const { error: rowsError } = await supabase.from("vehicle_import_rows").insert(
    logged.map((item) => ({
      batch_id: batch.id,
      row_index: item.row.rowIndex,
      bike_id: item.row.bikeId,
      outcome: item.outcome,
      message: item.message,
      vehicle_id: item.vehicleId,
      before: (item.row.before ?? null) as Json,
      after: (item.outcome === "failed" ? null : item.row.after) as Json,
    })),
  );
  if (rowsError) return { error: rowsError.message, applied, failed };

  await supabase
    .from("vehicle_import_batches")
    .update({ redoable: false })
    .eq("status", "undone")
    .neq("id", batch.id);

  void logAdminMutation({
    action: "create",
    entityType: "vehicle_import",
    entityId: batch.id,
    routeName: "/vehicles",
    after: { applied, failed, fileName: input.fileName },
  });
  return { applied, failed };
}

export async function undoVehicleImport(): Promise<{ error?: string }> {
  return replay("undo");
}

export async function redoVehicleImport(): Promise<{ error?: string }> {
  return replay("redo");
}

async function replay(direction: "undo" | "redo"): Promise<{ error?: string }> {
  const auth = await requireCreate();
  if ("error" in auth) return { error: auth.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_import_batches")
    .select("id, status, created_at, undo_seq, redoable")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message };
  const tips: VehicleImportBatchTip[] = (data ?? []).map((row) => ({
    id: row.id,
    status: row.status === "undone" ? "undone" : "applied",
    createdAt: row.created_at,
    undoSeq: row.undo_seq,
    redoable: row.redoable,
  }));
  const target = direction === "undo" ? undoTargetId(tips) : redoTargetId(tips);
  if (!target) return { error: direction === "undo" ? "nothing_to_undo" : "nothing_to_redo" };

  const { data: rows, error: rowsError } = await supabase
    .from("vehicle_import_rows")
    .select("outcome, vehicle_id, before, after")
    .eq("batch_id", target);
  if (rowsError) return { error: rowsError.message };

  for (const row of rows ?? []) {
    const outcome = row.outcome === "create" || row.outcome === "update" ? row.outcome : "failed";
    if (direction === "undo") {
      const plan = undoRowPlan({ outcome, vehicleId: row.vehicle_id, before: row.before });
      if (!plan) continue;
      if (plan.op === "delete") {
        const { error: deleteError } = await supabase.from("vehicles").delete().eq("id", plan.vehicleId);
        if (deleteError) return { error: deleteError.message };
      } else {
        const snapshot = plan.snapshot as VehicleSheetSnapshot;
        const { error: updateError } = await supabase
          .from("vehicles")
          .update(writePayload(snapshot))
          .eq("id", plan.vehicleId);
        if (updateError) return { error: updateError.message };
      }
    } else {
      const plan = redoRowPlan({ outcome, vehicleId: row.vehicle_id, after: row.after });
      if (!plan) continue;
      const snapshot = plan.snapshot as VehicleSheetSnapshot;
      if (plan.vehicleId) {
        const { data: found } = await supabase
          .from("vehicles")
          .select("id")
          .eq("id", plan.vehicleId)
          .maybeSingle();
        if (found) {
          const { error: updateError } = await supabase
            .from("vehicles")
            .update(writePayload(snapshot))
            .eq("id", plan.vehicleId);
          if (updateError) return { error: updateError.message };
          continue;
        }
      }
      const { error: insertError } = await supabase.from("vehicles").insert({
        ...writePayload(snapshot),
        ...(plan.vehicleId ? { id: plan.vehicleId } : {}),
        created_by: auth.session.id,
      });
      if (insertError) return { error: insertError.message };
    }
  }

  if (direction === "undo") {
    const { error: statusError } = await supabase
      .from("vehicle_import_batches")
      .update({
        status: "undone",
        undone_at: new Date().toISOString(),
        undo_seq: nextUndoSeq(tips),
        redoable: true,
      })
      .eq("id", target);
    if (statusError) return { error: statusError.message };
  } else {
    const { error: statusError } = await supabase
      .from("vehicle_import_batches")
      .update({ status: "applied", undone_at: null, redoable: true })
      .eq("id", target);
    if (statusError) return { error: statusError.message };
  }

  void logAdminMutation({
    action: "update",
    entityType: "vehicle_import",
    entityId: target,
    routeName: "/vehicles",
    after: { direction },
  });
  return {};
}
