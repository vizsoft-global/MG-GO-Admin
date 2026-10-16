"use server";

import { revalidatePath } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { resolveDriversByLookupIds } from "@/features/drivers/resolve-drivers-by-lookup-ids";
import {
  decideImportRowMatch,
  lookupToImportMatch,
  type ImportRowReason,
} from "@/features/drivers/resolve-import-row";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  buildComplianceWrites,
  commitComplianceWrites,
  dedupeResolvedRows,
  parseComplianceSheet,
} from "./compliance-parse";
import type {
  ComplianceApplyResult,
  CompliancePreviewResult,
  CompliancePreviewRow,
  ComplianceRowStatus,
  ComplianceSheet,
  ComplianceSheetIssues,
  ComplianceUploadRow,
} from "./types";

/** `MAX_REFRESH_DRIVERS` in functions/src/rpcs/driver-pay.ts. */
const NOTIFY_CHUNK = 500;

const EMPTY_STATUS_COUNTS: Record<ComplianceRowStatus, number> = {
  ok: 0,
  unknown_id: 0,
  ambiguous: 0,
  invalid_day: 0,
  invalid_number: 0,
  duplicate: 0,
};

function countStatuses(
  rows: Array<{ status: ComplianceRowStatus }>,
): Record<ComplianceRowStatus, number> {
  const counts = { ...EMPTY_STATUS_COUNTS };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function resolvedStatus(decided: ImportRowReason): ComplianceRowStatus {
  switch (decided) {
    case "ok":
      return "ok";
    case "ambiguous":
      return "ambiguous";
    case "empty":
    case "unknown_id":
    case "blocked":
    case "archived":
      return "unknown_id";
    default: {
      const _exhaustive: never = decided;
      return _exhaustive;
    }
  }
}

/**
 * Attach a rider to every parsed row.
 *
 * Only rows the parser already accepted are looked up: a row with a bad day or a
 * bad number is rejected on its own merits and never gets a second life here. A
 * blocked or archived rider is reported and skipped rather than written — their
 * app cannot paint the card, so a document would be invisible data.
 */
export async function resolveComplianceRows(rows: ComplianceUploadRow[]): Promise<{
  rows: CompliancePreviewRow[];
  statusCounts: Record<ComplianceRowStatus, number>;
}> {
  const parserOk = rows.filter((row) => row.status === "ok");
  const lookups = [
    ...new Set(
      parserOk.flatMap((row) => [row.employee_id, row.driver_code].filter(Boolean)),
    ),
  ];

  const resolved = lookups.length > 0 ? await resolveDriversByLookupIds(lookups) : [];
  const byLookup = new Map(resolved.map((row) => [row.lookup_id, row]));

  const preview: CompliancePreviewRow[] = rows.map((row) => {
    if (row.status !== "ok") {
      return { ...row, driver_id: null, driver_name: null };
    }
    const match = (lookupId: string) => {
      const found = byLookup.get(lookupId);
      return found ? lookupToImportMatch(found) : null;
    };
    const decided = decideImportRowMatch({
      employeeId: row.employee_id,
      driverCode: row.driver_code,
      byEmployee: match(row.employee_id),
      byCode: match(row.driver_code),
    });
    const status = resolvedStatus(decided.status);
    return {
      ...row,
      status,
      driver_id: status === "ok" ? (decided.driver?.driver_id ?? null) : null,
      driver_name: decided.driver?.full_name ?? null,
    };
  });

  const deduped = dedupeResolvedRows(preview);
  return { rows: deduped.rows, statusCounts: countStatuses(deduped.rows) };
}

/** Re-parse a raw sheet server-side, then resolve it. Both actions go through this. */
export async function resolveComplianceSheet(sheet: ComplianceSheet): Promise<{
  rows: CompliancePreviewRow[];
  issues: ComplianceSheetIssues;
  statusCounts: Record<ComplianceRowStatus, number>;
}> {
  const parsed = parseComplianceSheet(sheet);
  const resolved = await resolveComplianceRows(parsed.rows);
  return {
    rows: resolved.rows,
    issues: parsed.issues,
    statusCounts: resolved.statusCounts,
  };
}

export async function previewRiderComplianceUpload(input: {
  sheet: ComplianceSheet;
}): Promise<CompliancePreviewResult> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "compliance.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  try {
    const { rows, issues, statusCounts } = await resolveComplianceSheet(input.sheet);
    return { preview: { rows, issues, statusCounts } };
  } catch {
    return { error: "lookup_failed" };
  }
}

/**
 * Ping the riders whose numbers changed.
 *
 * Best-effort by design: the documents are authoritative and the push only makes an
 * open app repaint sooner, so a failed call is logged rather than thrown — a 500
 * from FCM must not turn a committed upload into an error the operator retries.
 */
async function notifyComplianceRefresh(driverIds: string[]): Promise<number> {
  let notified = 0;
  for (let i = 0; i < driverIds.length; i += NOTIFY_CHUNK) {
    const chunk = driverIds.slice(i, i + NOTIFY_CHUNK);
    const { error } = await callAdminFunction("admin_notify_compliance_refresh", {
      driver_ids: chunk,
    });
    if (error) {
      console.error(
        `[compliance-upload] refresh failed for ${chunk.length} drivers: ${error.message}`,
      );
      continue;
    }
    notified += chunk.length;
  }
  return notified;
}

/**
 * Write one document per rider-day, then ping the riders whose numbers changed.
 *
 * The write is authoritative and the push is best-effort: a failed refresh call
 * leaves correct data the app picks up on its next cold read, so it is logged and
 * not thrown. Re-uploading a day overwrites that day (`set` with merge on the
 * same `{driverId}_{day}` id), which is what makes a corrected file idempotent.
 */
export async function applyRiderComplianceUpload(input: {
  locale: string;
  fileName: string;
  sheet: ComplianceSheet;
}): Promise<ComplianceApplyResult> {
  const auth = await requireMutationAuth("compliance.manage");
  if ("error" in auth) {
    return {
      error: auth.error === "not_configured" ? "not_configured" : "not_authorized",
    };
  }

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  let resolved: Awaited<ReturnType<typeof resolveComplianceSheet>>;
  try {
    resolved = await resolveComplianceSheet(input.sheet);
  } catch (error) {
    return {
      error: "write_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }

  if (resolved.issues.missingRequiredColumns.length > 0) {
    return {
      error: "missing_columns",
      missingRequiredColumns: resolved.issues.missingRequiredColumns,
      statusCounts: resolved.statusCounts,
    };
  }

  const writable = resolved.rows.filter((row) => row.status === "ok" && row.driver_id);
  if (writable.length === 0) {
    return { error: "no_rows", statusCounts: resolved.statusCounts };
  }

  const batchId = `${Date.now()}_${auth.session.id}`;
  const fileName = input.fileName.slice(0, 160);
  const writes = buildComplianceWrites(writable, {
    batchId,
    fileName,
    uploadedBy: auth.session.id,
    uploadedAt: new Date(),
  });

  const collection = db.collection(COLLECTIONS.riderComplianceDaily);

  const { committed, failure } = await commitComplianceWrites(writes, async (chunk) => {
    const batch = db.batch();
    for (const write of chunk) {
      batch.set(collection.doc(write.id), write.data, { merge: true });
    }
    await batch.commit();
  });

  const driverIds = [...new Set(committed.map((write) => write.data.driver_id as string))];
  const notifiedDrivers = await notifyComplianceRefresh(driverIds);

  const days = committed.map((write) => write.data.day as string).sort();
  void logAdminMutation({
    action: "create",
    entityType: "rider_compliance_daily",
    entityId: batchId,
    routeName: "applyRiderComplianceUpload",
    success: failure === null,
    errorMessage: failure instanceof Error ? failure.message : undefined,
    after: {
      file_name: fileName,
      planned_rows: writes.length,
      written_rows: committed.length,
      drivers: driverIds.length,
      first_day: days[0],
      last_day: days[days.length - 1],
    },
  });

  if (failure) {
    return {
      error: "partial_write",
      writtenRows: committed.length,
      driverCount: driverIds.length,
      notifiedDrivers,
      statusCounts: resolved.statusCounts,
      errorDetail: failure instanceof Error ? failure.message : String(failure),
    };
  }

  revalidatePath(`/${input.locale}/compliance`, "page");

  return {
    success: true,
    totalRows: resolved.rows.length,
    writtenRows: committed.length,
    driverCount: driverIds.length,
    notifiedDrivers,
    statusCounts: resolved.statusCounts,
  };
}
