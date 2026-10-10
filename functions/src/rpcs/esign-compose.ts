import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff, type StaffContext } from "../core/staff";
import { dataOf, isoTimestamp, logAdminActivity, pickId, textOrNull, type Dict } from "./_shared";
import {
  MAX_SIGNATURE_BYTES,
  MAX_SOURCE_BYTES,
  composeSignedPdf,
  esignObjectPath,
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

    let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
    try {
      bucket = getStorage().bucket();
    } catch (error) {
      console.error("esign compose storage", error);
      return { ok: false, error: "server_misconfigured" };
    }

    if (textOrNull(row.signed_document_storage_key) === outputKey) {
      const existing = bucket.file(esignObjectPath(outputKey));
      const [exists] = await existing.exists().catch(() => [false] as const);
      if (exists) {
        let bytes = 0;
        try {
          const [meta] = await existing.getMetadata();
          bytes = Number(meta.size ?? 0);
        } catch {
          bytes = 0;
        }
        return {
          ok: true,
          already_generated: true,
          request_id: requestId,
          storage_key: outputKey,
          bytes: Number.isFinite(bytes) ? bytes : 0,
        };
      }
    }

    const [sourceFile, signatureFile] = await Promise.all([
      readObject(bucket, documentKey),
      readObject(bucket, signatureKey),
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

    let pdfBytes: Uint8Array;
    let pageCount = 0;
    try {
      const composed = await composeSignedPdf({
        sourceBytes: sourceFile,
        sourceKind,
        signatureBytes: signatureFile,
        signatureKind,
        captions,
      });
      pdfBytes = composed.pdfBytes;
      pageCount = composed.pageCount;
    } catch (error) {
      console.error("esign compose failed", error);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "empty_document") return fail("empty_document");
      return fail("compose_failed", { detail: message });
    }

    try {
      await bucket.file(esignObjectPath(outputKey)).save(Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        resumable: false,
      });
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

function formatSignedAt(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 16)} UTC`;
}

async function readObject(
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>,
  key: string,
): Promise<Buffer | null> {
  try {
    const file = bucket.file(esignObjectPath(key));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [bytes] = await file.download();
    return bytes;
  } catch (error) {
    console.error("esign compose download", error);
    return null;
  }
}
