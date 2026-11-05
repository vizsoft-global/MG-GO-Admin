"use server";

/**
 * Accident Management — the one writer.
 *
 * `createAccident` is the only place a case is created. The vehicle-detail
 * dialog's old entry point (`createVehicleAccident` in
 * `src/features/vehicles/vehicle-tabs-actions.ts`) is a thin delegation to this
 * module's shared payload builder, so two different document shapes cannot exist.
 *
 * Reads are re-exported as thin async wrappers because a client component may
 * only import a `"use server"` module; the reads themselves live in the plain
 * module `accident-reads.ts`.
 */
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getPresignedGetUrl, putObject } from "@/lib/storage/r2-client";
import { buildVehicleFileKey, extensionFromMime, isR2ObjectKey } from "@/lib/storage/r2-keys";
import { accidentAttachmentKeyProblem } from "./accident-attachment-rules";
import {
  accidentAttachmentKeys,
  accidentWritePayload,
  editableAccidentFields,
  isRiderReportAwaitingCompletion,
  validateAccidentInput,
} from "./accident-model";
import { ACCIDENT_REFERENCE_COUNTER, formatAccidentReference } from "./accident-reference";
import {
  attachmentMetaFromKeys,
  getAccident as readAccident,
  keyClaimedByAccident,
  listAccidentVehicles as readVehicleOptions,
  listAccidents as readAccidents,
  openDb,
  requireAccidents,
  sessionName,
  vehicleSnapshotFor,
  VEHICLE_ACCIDENTS,
} from "./accident-reads";
import {
  isAccidentCaseStatus,
  MAX_ACCIDENT_ATTACHMENTS,
  type AccidentAttachmentMeta,
  type AccidentCaseStatus,
  type AccidentInput,
  type AccidentRow,
  type AccidentVehicleOption,
} from "./accident-types";

const ROUTE_NAME = "/fleet/accident";
const SIGNED_URL_TTL = 900;

/* ---------------------------------------------------------------- reads --- */

export async function listAccidents(): Promise<AccidentRow[]> {
  return readAccidents();
}

export async function getAccident(id: string): Promise<AccidentRow | null> {
  return readAccident(id);
}

export async function listAccidentVehicles(): Promise<AccidentVehicleOption[]> {
  return readVehicleOptions();
}

/**
 * A short-lived GET for one attachment. The service account signs it; no object
 * key is ever handed to the browser as a permanent URL.
 *
 * A key is only signed when an accident record actually references it. Without
 * that check a `vehicles.view`-only account could name any `drivers/…` object and
 * read it, which `getSignedStorageUrl` would not allow.
 */
export async function resolveAccidentAttachments(
  keys: readonly string[],
): Promise<{ key: string; url: string | null; contentType: string | null }[]> {
  const auth = await requireAccidents("vehicles.view");
  if ("error" in auth) return [];
  const out: { key: string; url: string | null; contentType: string | null }[] = [];
  for (const key of keys) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    if (!isR2ObjectKey(trimmed) || !(await keyClaimedByAccident(trimmed))) {
      out.push({ key: trimmed, url: null, contentType: null });
      continue;
    }
    try {
      const url = await getPresignedGetUrl(trimmed, SIGNED_URL_TTL);
      out.push({ key: trimmed, url, contentType: null });
    } catch {
      out.push({ key: trimmed, url: null, contentType: null });
    }
  }
  return out;
}

/** The audit row an Excel export leaves behind. The workbook is built in the browser. */
export async function recordAccidentExport(count: number): Promise<void> {
  const auth = await requireMutationAuth();
  if ("error" in auth) return;
  await logAdminMutation({
    action: "export",
    entityType: "vehicle_accident",
    routeName: ROUTE_NAME,
    context: { rows: count },
  });
}

/* --------------------------------------------------------------- writes --- */

/**
 * `ACC-0001`, `ACC-0002`, … One counter document, one transaction, so two
 * operators filing at the same second cannot take the same number.
 */
async function allocateAccidentReference(): Promise<string> {
  const db = await openDb();
  const ref = db.collection(COLLECTIONS.counters).doc(ACCIDENT_REFERENCE_COUNTER);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = Number(snap.data()?.value ?? 0);
    const value = (Number.isFinite(current) ? current : 0) + 1;
    tx.set(ref, { value, updated_at: new Date() }, { merge: true });
    return value;
  });
  return formatAccidentReference(next);
}

type WriteAuth = { session: { id: string; profile?: { full_name?: string | null } } };

async function requireWrite(): Promise<WriteAuth | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireAccidents("vehicles.manage");
  if ("error" in auth) return { error: "not_authorized" };
  return { session: auth.session };
}

export async function uploadAccidentAttachment(
  formData: FormData,
): Promise<{ attachment: AccidentAttachmentMeta } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };

  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const file = formData.get("file");
  if (!vehicleId || !(file instanceof File) || file.size === 0) {
    return { error: "missing_fields" };
  }
  if (file.size > 50 * 1024 * 1024) return { error: "file_too_large" };
  const extension = extensionFromMime(file.type || "application/octet-stream");
  const key = buildVehicleFileKey(vehicleId, "accidents", extension);
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", {
      uploadedBy: auth.session.id,
      entityType: "vehicle_accident",
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

async function claimProblem(keys: readonly string[], excludeId?: string): Promise<string | null> {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (unique.length > MAX_ACCIDENT_ATTACHMENTS) return "too_many_attachments";
  for (const key of unique) {
    const problem = accidentAttachmentKeyProblem(key);
    if (problem) return problem;
    if (await keyClaimedByAccident(key, excludeId)) return "attachment_claimed";
  }
  return null;
}

export async function createAccident(
  input: AccidentInput,
): Promise<{ id: string; reference: string } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };

  const snapshot = await vehicleSnapshotFor(input.vehicleId);
  if (!snapshot) return { error: "missing_vehicle" };

  const validation = validateAccidentInput(input);
  if (!validation.ok) return { error: validation.error };

  const claimant = await claimProblem(input.attachmentKeys);
  if (claimant) return { error: claimant };

  const attachments =
    input.attachmentKeys.length > 0 ? await attachmentMetaFromKeys(input.attachmentKeys) : [];

  const reference = await allocateAccidentReference();
  const now = new Date();
  const payload = accidentWritePayload(input, snapshot, {
    reference,
    attachments,
    source: "admin",
    reportedBy: auth.session.id,
    reportedByName: sessionName(auth.session),
    caseStatus: isAccidentCaseStatus(input.caseStatus) ? input.caseStatus : "pending",
    vehicleCaseStatus: input.vehicleCaseStatus,
    now,
  });

  const db = await openDb();
  const ref = db.collection(VEHICLE_ACCIDENTS).doc();
  try {
    await ref.set(payload);
  } catch {
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "create",
    entityType: "vehicle_accident",
    entityId: ref.id,
    routeName: ROUTE_NAME,
    after: { ...payload, occurred_at: now.toISOString() },
  });
  return { id: ref.id, reference };
}


export async function updateAccident(
  id: string,
  input: AccidentInput,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };

  const current = await readAccident(id);
  if (!current) return { error: "not_found" };

  const validation = validateAccidentInput(input);
  if (!validation.ok) return { error: validation.error };

  const claimant = await claimProblem(input.attachmentKeys, id);
  if (claimant) return { error: claimant };

  const attachments = await attachmentMetaFromKeys(
    input.attachmentKeys,
    current.attachments,
  );

  // The snapshot is frozen at report time: an edit re-writes it from the stored
  // row, never from the vehicle's current state.
  const snapshot = {
    plate: current.plate_snapshot,
    company_name: current.vehicle_company_name,
    model_year: current.model_year,
    driver_id: current.driver_id,
    driver_name: current.driver_name,
    driver_code: current.driver_code,
    employee_id: current.employee_id,
  };

  const now = new Date();
  const payload = accidentWritePayload(
    { ...input, vehicleId: current.vehicle_id },
    snapshot,
    {
      reference: current.reference ?? "",
      attachments,
      source: current.source,
      reportedBy: current.reported_by,
      reportedByName: current.reported_by_name,
      caseStatus: isAccidentCaseStatus(input.caseStatus)
        ? input.caseStatus
        : current.case_status ?? "pending",
      vehicleCaseStatus: input.vehicleCaseStatus,
      now,
    },
  );
  const patch = editableAccidentFields(payload);
  // Completing a rider report is what `reviewed_*` records; it is not a status.
  const completing = isRiderReportAwaitingCompletion(current) &&
    isAccidentCaseStatus(input.caseStatus) && input.caseStatus === "close";
  if (completing) {
    patch.reviewed_at = now;
    patch.reviewed_by = auth.session.id;
    patch.reviewed_by_name = sessionName(auth.session);
  }

  const db = await openDb();
  try {
    await db.collection(VEHICLE_ACCIDENTS).doc(id).update(patch);
  } catch {
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "update",
    entityType: "vehicle_accident",
    entityId: id,
    routeName: ROUTE_NAME,
    before: { ...current },
    after: patch,
  });
  return { ok: true };
}

/** Close / Pending / Delay from the list's row menu or the detail page. */
export async function setAccidentCase(
  id: string,
  status: string,
  note?: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };
  if (!isAccidentCaseStatus(status)) return { error: "invalid_case_status" };

  const current = await readAccident(id);
  if (!current) return { error: "not_found" };

  const now = new Date();
  const patch: Record<string, unknown> = {
    case_status: status as AccidentCaseStatus,
    updated_at: now,
  };
  if (note?.trim()) patch.review_note = note.trim().slice(0, 400);
  if (status === "close" && !current.reviewed_at) {
    patch.reviewed_at = now;
    patch.reviewed_by = auth.session.id;
    patch.reviewed_by_name = sessionName(auth.session);
  }

  const db = await openDb();
  try {
    await db.collection(VEHICLE_ACCIDENTS).doc(id).update(patch);
  } catch {
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "update",
    entityType: "vehicle_accident",
    entityId: id,
    routeName: ROUTE_NAME,
    before: { case_status: current.case_status, reviewed_at: current.reviewed_at },
    after: patch,
  });
  return { ok: true };
}

/**
 * Links a freshly uploaded file to an existing case. The file was already written
 * by `uploadAccidentAttachment`; this is the step that makes it evidence.
 */
export async function appendAccidentAttachment(
  id: string,
  key: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };

  const current = await readAccident(id);
  if (!current) return { error: "not_found" };

  const nextKeys = [...current.attachment_keys, key];
  const problem = await claimProblem(nextKeys, id);
  if (problem) return { error: problem };

  const meta = await attachmentMetaFromKeys(nextKeys, current.attachments);
  const db = await openDb();
  try {
    await db.collection(VEHICLE_ACCIDENTS).doc(id).update({
      attachment_keys: nextKeys,
      attachment_meta: meta,
      updated_at: new Date(),
    });
  } catch {
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "update",
    entityType: "vehicle_accident",
    entityId: id,
    routeName: ROUTE_NAME,
    before: { attachment_keys: current.attachment_keys },
    after: { attachment_keys: nextKeys },
  });
  return { ok: true };
}

/**
 * Unlinks one attachment from the case. The object itself is kept: an accident is
 * compliance evidence, so nothing is destroyed from this screen.
 */
export async function removeAccidentAttachment(
  id: string,
  key: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireWrite();
  if ("error" in auth) return { error: auth.error };

  const current = await readAccident(id);
  if (!current) return { error: "not_found" };

  const all = accidentAttachmentKeys(current);
  if (!all.includes(key)) return { error: "not_found" };
  const keys = current.attachment_keys.filter((entry) => entry !== key);
  const meta = current.attachments.filter((entry) => entry.key !== key);

  const db = await openDb();
  try {
    await db.collection(VEHICLE_ACCIDENTS).doc(id).update({
      attachment_keys: keys,
      attachment_meta: meta,
      // A legacy single attachment is cleared by name; the object stays in R2.
      storage_key: current.storage_key === key ? null : current.storage_key,
      updated_at: new Date(),
    });
  } catch {
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "update",
    entityType: "vehicle_accident",
    entityId: id,
    routeName: ROUTE_NAME,
    before: { attachment_keys: current.attachment_keys },
    after: { attachment_keys: keys },
  });
  return { ok: true };
}

