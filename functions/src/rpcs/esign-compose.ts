import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  esignStorageConfigured,
  headEsignStoredObject,
  putEsignStoredObject,
  readEsignStoredObject,
} from "../core/esign-object-store";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff, type StaffContext } from "../core/staff";
import { dataOf, isoTimestamp, logAdminActivity, pickId, textOrNull, type Dict } from "./_shared";
import {
  MAX_SIGNATURE_BYTES,
  MAX_SOURCE_BYTES,
  STAFF_SLOT_MISSING,
  composeSignedPdf,
  esignObjectPath,
  parseStampLayout,
  placementFromLayout,
  resolveStaffStampSlots,
  signedDocumentSourceHash,
  sniff,
  validateImage,
  type ComposeStamp,
  type StaffSlotSource,
} from "./esign-compose-logic";
import {
  ESIGN_SHEET_RENDER_VERSION,
  resolveEmployeeStampSlot,
  type SignSlot,
} from "./esign-signature-slots";

/**
 * 1GiB cannot run at the fleet `cpu: 0.08` — Cloud Run's minimum for 1GiB is
 * 0.583 vCPU — so this function is the one that raises CPU. Concurrency stays 1.
 * Region stays me-central1 (gen2 upload to me-central2 is refused on this project).
 */
export const esignComposeSignedDocument = onCall(
  {
    region: "me-central1",
    memory: "1GiB",
    cpu: 1,
    timeoutSeconds: 120,
    concurrency: 1,
    maxInstances: 2,
  },
  async (request) => {
    const staff = await requireStaff(request);
    if (!staffMayCompose(staff)) {
      throw new HttpsError("permission-denied", "not_authorized");
    }

    const data = (request.data ?? {}) as Dict;
    const requestId = pickId(data, "requestId", "p_request_id", "request_id");
    if (!requestId) return { ok: false, error: "request_id_required" };
    return composeSignedEsignRequest(requestId, {
      force: data.force === true || data.p_force === true,
      actorId: staff.uid,
    });
  },
);

/** Stamps the rider signature even while a staff counter-signature is still pending. */
export async function composeSignedEsignRequest(
  requestId: string,
  options: { force?: boolean; actorId?: string | null },
): Promise<Dict> {
    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.esignRequests).doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "not_found" };

    const row = dataOf(snap);
    const status = String(row.status ?? "");
    if (status !== "signed") return { ok: false, error: "not_signed", status };

    const documentKey = textOrNull(row.document_storage_key);
    const signatureKey = textOrNull(row.signature_storage_key);
    if (!documentKey) return { ok: false, error: "no_source_document" };
    if (!signatureKey) return { ok: false, error: "no_signature" };

    const signerSnap = await db
      .collection(COLLECTIONS.esignRequestSigners)
      .where("request_id", "==", requestId)
      .get();
    const signerRows = signerSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));

    const signedStaff = signerRows.flatMap(({ id, data: signer }) => {
      if (signer.status !== "signed") return [];
      const storageKey = textOrNull(signer.signature_storage_key);
      if (!storageKey) return [];
      return [
        {
          id,
          sortOrder: Number.isFinite(Number(signer.sort_order)) ? Number(signer.sort_order) : 0,
          signatureKey: storageKey,
          signedAt: isoTimestamp(signer.signed_at),
          displayName:
            textOrNull(signer.signer_display_name) ?? textOrNull(signer.staff_contact) ?? "",
        },
      ];
    });
    // A `signature_slots` array measured on an older printed sheet describes
    // boxes this compose no longer draws, so it is ignored in favour of the
    // kind's printed geometry. That is also what re-measures every pre-fix row
    // once, and is why the sheet version is part of the source hash.
    const renderVersion =
      typeof row.sheet_render_version === "number" ? row.sheet_render_version : null;
    const slotsStale = renderVersion === null || renderVersion < ESIGN_SHEET_RENDER_VERSION;
    const persistedSlots = slotsStale ? null : row.signature_slots;

    let assignments: Array<
      { id: string; sortOrder: number; signatureKey: string; signedAt: string | null; displayName: string } & {
        slot: SignSlot;
      }
    > = [];
    let slotsSource: StaffSlotSource = "kind_fallback";
    try {
      const resolved = resolveStaffStampSlots({
        kind: row.document_kind,
        persistedSlots,
        signers: signedStaff,
      });
      assignments = resolved.assignments;
      slotsSource = resolved.slotsSource;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(STAFF_SLOT_MISSING)) {
        // A signer with no printed box is a refusal, not a silently thinner
        // document: the HR signature must never go missing without a reason.
        return fail(STAFF_SLOT_MISSING, {
          detail: message,
          slots_source: slotsSource,
        });
      }
      throw error;
    }
    if (signedStaff.length > assignments.length) {
      console.warn("esign compose: staff signatures past the printed slots", {
        requestId,
        signed: signedStaff.length,
        slots: assignments.length,
      });
    }
    const staffBySigner = new Map(signedStaff.map((row) => [row.id, row]));

    const requestCode = textOrNull(row.request_code) ?? requestId;
    const outputKey = `signed/${requestId}/${requestCode}-signed.pdf`;
    const sourceHash = signedDocumentSourceHash({
      documentKey,
      employeeSignatureKey: signatureKey,
      employeeSignedAt: isoTimestamp(row.signed_at),
      stampLayout: row.stamp_layout ?? null,
      signatureSlots: persistedSlots,
      staffSlots: assignments.map((row) => ({
        id: row.id,
        role: row.slot.role,
        page: row.slot.page,
        xPt: row.slot.xPt,
        yPt: row.slot.yPt,
        wPt: row.slot.wPt,
        hPt: row.slot.hPt,
      })),
      sheetRenderVersion: renderVersion,
      staff: assignments.map((row) => ({
        id: row.id,
        signatureKey: row.signatureKey,
        signedAt: row.signedAt,
      })),
    });

    async function fail(code: string, extra: Dict = {}) {
      await ref.update({
        signed_document_error: code,
        signed_document_pending: false,
        updated_at: Timestamp.now(),
      });
      return { ok: false, error: code, request_id: requestId, ...extra };
    }

    if (!esignStorageConfigured()) {
      return { ok: false, error: "server_misconfigured" };
    }

    const layoutNewer = stampMillis(row.stamp_layout_at) > stampMillis(row.signed_document_generated_at);
    const force =
      options.force === true ||
      layoutNewer ||
      textOrNull(row.signed_document_source_hash) !== sourceHash;

    if (!force && textOrNull(row.signed_document_storage_key) === outputKey) {
      try {
        const existing = await headEsignStoredObject(esignObjectPath(outputKey));
        if (existing.exists) {
          return {
            ok: true,
            already_generated: true,
            request_id: requestId,
            storage_key: outputKey,
            bytes: Number.isFinite(existing.size) ? existing.size : 0,
          };
        }
      } catch (error) {
        console.error("esign compose storage", error);
        return { ok: false, error: "server_misconfigured" };
      }
    }

    const staffFiles = await Promise.all(
      assignments.map(async (assignment) => {
        const file = await readObject(assignment.signatureKey);
        if (!file) return { assignment, file: null };
        if (file.length > MAX_SIGNATURE_BYTES) return { assignment, file: null, tooLarge: true };
        const kind = sniff(file);
        if (kind !== "png" && kind !== "jpeg") return { assignment, file: null };
        if (validateImage(file, kind)) return { assignment, file: null };
        return { assignment, file, kind };
      }),
    );
    const missingStaff = staffFiles.find((row) => !row.file);
    if (missingStaff) {
      return fail("staff_signature_unavailable", {
        detail: `signature for ${missingStaff.assignment.id} is missing or unreadable`,
      });
    }

    const [sourceFile, signatureFile] = await Promise.all([
      readObject(documentKey),
      readObject(signatureKey),
    ]);
    if (!sourceFile) return fail("source_document_unavailable");
    if (!signatureFile) return fail("signature_unavailable");

    if (sourceFile.length > MAX_SOURCE_BYTES) {
      return fail("source_too_large", {
        detail: `${sourceFile.length} bytes exceeds the ${MAX_SOURCE_BYTES} byte limit.`,
      });
    }
    if (signatureFile.length > MAX_SIGNATURE_BYTES) {
      return fail("signature_too_large", {
        detail: `${signatureFile.length} bytes exceeds the ${MAX_SIGNATURE_BYTES} byte limit.`,
      });
    }

    const sourceKind = sniff(sourceFile);
    if (sourceKind === "unsupported") {
      return fail("unsupported_source_type", {
        detail:
          "Only PDF, PNG and JPEG source documents can be composed. WebP and other formats must be re-uploaded as PDF.",
      });
    }
    const signatureKind = sniff(signatureFile);
    if (signatureKind !== "png" && signatureKind !== "jpeg") {
      return fail("unsupported_signature_type", { detail: "Signature must be PNG or JPEG." });
    }

    const sourceDefect = validateImage(sourceFile, sourceKind);
    if (sourceDefect) return fail("malformed_source_image", { detail: sourceDefect });
    const signatureDefect = validateImage(signatureFile, signatureKind);
    if (signatureDefect) return fail("malformed_signature_image", { detail: signatureDefect });

    const signedAt = formatSignedAt(isoTimestamp(row.signed_at));
    const captions = [
      textOrNull(row.signer_display_name) || "Signed by driver",
      signedAt,
      textOrNull(row.request_code) ?? "",
    ];
    const snapshot =
      row.employee_snapshot && typeof row.employee_snapshot === "object"
        ? (row.employee_snapshot as Dict)
        : {};
    const snapshotText = (key: string) => textOrNull(snapshot[key]) ?? "";
    const placement = placementFromLayout(parseStampLayout(row.stamp_layout) ?? { pieces: [] }, {
      name: captions[0] ?? "",
      date: captions[1] ?? "",
      code: captions[2] ?? "",
      employeeId: snapshotText("employee_id") || (textOrNull(row.employee_id) ?? ""),
      company: snapshotText("company_name"),
      position: snapshotText("position"),
      civilId: snapshotText("civil_id"),
      zone: snapshotText("zone"),
    });
    const stamps: ComposeStamp[] = [
      {
        bytes: signatureFile,
        kind: signatureKind,
        slot:
          placement?.signature ??
          resolveEmployeeStampSlot({
            persisted: row.signature_slots,
            kind: row.document_kind,
          }),
        captions,
        placement,
      },
    ];
    for (const entry of staffFiles) {
      if (!entry.file || (entry.kind !== "png" && entry.kind !== "jpeg")) continue;
      const signer = staffBySigner.get(entry.assignment.id);
      stamps.push({
        bytes: entry.file,
        kind: entry.kind,
        slot: entry.assignment.slot,
        captions: [signer?.displayName ?? "", formatSignedAt(entry.assignment.signedAt)],
        reserveCaption: true,
      });
    }

    let pdfBytes: Uint8Array;
    let pageCount = 0;
    try {
      const composed = await composeSignedPdf({
        sourceBytes: sourceFile,
        sourceKind,
        signatureBytes: signatureFile,
        signatureKind,
        captions,
        kind: row.document_kind,
        persistedSlots,
        placement,
        stamps,
      });
      pdfBytes = composed.pdfBytes;
      pageCount = composed.pageCount;
    } catch (error) {
      console.error("esign compose failed", error);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "empty_document") return fail("empty_document");
      if (message === "missing_employee_signature_slot" || message === "invalid_signature_slot") {
        return fail(message);
      }
      return fail("compose_failed", { detail: message });
    }

    try {
      await putEsignStoredObject(esignObjectPath(outputKey), Buffer.from(pdfBytes), "application/pdf");
    } catch (error) {
      console.error("esign compose upload", error);
      return fail("upload_failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const now = Timestamp.now();
    try {
      await ref.update({
        signed_document_storage_key: outputKey,
        signed_document_generated_at: now,
        signed_document_source_hash: sourceHash,
        signed_document_pending: false,
        signed_document_error: null,
        updated_at: now,
      });
    } catch (error) {
      console.error("esign compose persist", error);
      return { ok: false, error: "persist_failed", request_id: requestId };
    }

    if (options.actorId) {
      await logAdminActivity({
        actorId: options.actorId,
        action: "update",
        entity: "esign_requests",
        entityId: requestId,
        detail: { route_name: "esign.compose", storage_key: outputKey, pages: pageCount },
      });
    }

    return {
      ok: true,
      already_generated: false,
      request_id: requestId,
      storage_key: outputKey,
      bytes: pdfBytes.length,
      pages: pageCount,
      source_kind: sourceKind,
      // Where the staff boxes came from: "persisted" when the measured sheet was
      // trusted, "mixed" when a missing role was filled from the kind, and
      // "kind_fallback" when the whole measured array was stale.
      slots_source: slotsSource,
      staff_stamped: assignments.length,
    };
}

function staffMayCompose(staff: StaffContext): boolean {
  if (staff.isSuperAdmin || staff.isManager) return true;
  const slugs = staff.permissionSlugs;
  if (slugs.has("esign.sign") || slugs.has("employeedesk.manage") || slugs.has("requests.manage")) {
    return true;
  }
  return slugs.has("requests.create") || slugs.has("requests.edit") || slugs.has("requests.delete");
}

function stampMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function formatSignedAt(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 16)} UTC`;
}

async function readObject(key: string): Promise<Buffer | null> {
  try {
    return await readEsignStoredObject(esignObjectPath(key));
  } catch (error) {
    console.error("esign compose download", error instanceof Error ? error.name : "error");
    return null;
  }
}
