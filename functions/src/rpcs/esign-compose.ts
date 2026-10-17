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
  composeSignedPdf,
  esignObjectPath,
  parseStampLayout,
  placementFromLayout,
  sniff,
  validateImage,
} from "./esign-compose-logic";

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

    const requestId = pickId((request.data ?? {}) as Dict, "requestId", "p_request_id", "request_id");
    if (!requestId) return { ok: false, error: "request_id_required" };

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
    const awaitingStaff = signerSnap.docs.some((doc) => {
      const signer = doc.data();
      const staffId = signer.staff_user_id;
      return typeof staffId === "string" && staffId.trim() !== "" && signer.status === "pending";
    });
    if (awaitingStaff) return { ok: false, error: "awaiting_counter_signature" };

    const requestCode = textOrNull(row.request_code) ?? requestId;
    const outputKey = `signed/${requestId}/${requestCode}-signed.pdf`;

    async function fail(code: string, extra: Dict = {}) {
      await ref.update({
        signed_document_error: code,
        updated_at: Timestamp.now(),
      });
      return { ok: false, error: code, request_id: requestId, ...extra };
    }

    if (!esignStorageConfigured()) {
      return { ok: false, error: "server_misconfigured" };
    }

    const data = (request.data ?? {}) as Dict;
    const layoutNewer = stampMillis(row.stamp_layout_at) > stampMillis(row.signed_document_generated_at);
    const force = data.force === true || data.p_force === true || layoutNewer;

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
        persistedSlots: row.signature_slots,
        placement,
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
        signed_document_error: null,
        updated_at: now,
      });
    } catch (error) {
      console.error("esign compose persist", error);
      return { ok: false, error: "persist_failed", request_id: requestId };
    }

    await logAdminActivity({
      actorId: staff.uid,
      action: "update",
      entity: "esign_requests",
      entityId: requestId,
      detail: { route_name: "esign.compose", storage_key: outputKey, pages: pageCount },
    });

    return {
      ok: true,
      already_generated: false,
      request_id: requestId,
      storage_key: outputKey,
      bytes: pdfBytes.length,
      pages: pageCount,
      source_kind: sourceKind,
    };
  },
);

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
