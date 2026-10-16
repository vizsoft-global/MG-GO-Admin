"use server";

import { Timestamp } from "firebase-admin/firestore";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  MAX_SIGNATURE_BYTES,
  MAX_SOURCE_BYTES,
  composeSignedPdf,
  placementFromLayout,
  sniff,
  validateImage,
} from "../../../functions/src/rpcs/esign-compose-logic";
import { normalizeDocumentKind } from "./document-kind";
import { sanitizeEditedSheetHtml } from "./esign-sheet-edit";
import { putEsignObject, readEsignObject } from "./esign-r2";
import {
  filledEsignSheetHtml,
  snapshotFromStored,
  type FilledSheetField,
} from "./render/esign-filled-sheet";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";
import {
  formatStampInstant,
  parseStampLayout,
  type StampLayout,
  type StampPiece,
  type StampPieceLabels,
} from "./esign-stamp-layout";
import { launchEsignBrowser, renderStoredSheetPdf } from "./render/esign-pdf-renderer";
import { parseSignatureSlots, slotsForKind, type SignSlot } from "./render/esign-document-layout";

function mayPlace(session: {
  isSuperAdmin: boolean;
  isManager: boolean;
  permissions: Set<string>;
}): boolean {
  return (
    session.isSuperAdmin ||
    session.isManager ||
    hasPermissionInSet(session.permissions, "requests.manage", false) ||
    hasPermissionInSet(session.permissions, "employeedesk.manage", false)
  );
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stampLabelsFromRow(row: Record<string, unknown>): StampPieceLabels {
  const snap = snapshotFromStored(row.employee_snapshot);
  return {
    name: textOrNull(row.signer_display_name) || snap?.employee_name || "Signed by driver",
    date: formatStampInstant(row.signed_at),
    code: textOrNull(row.request_code) ?? "",
    employeeId: snap?.employee_id || textOrNull(row.employee_id) || "",
    company: snap?.company_name ?? "",
    position: snap?.position ?? "",
    civilId: snap?.civil_id ?? "",
    zone: snap?.zone ?? "",
  };
}

function withEmployeeSlot(kind: unknown, persisted: unknown, piece: StampPiece): SignSlot[] {
  const base = parseSignatureSlots(persisted) ?? slotsForKind(normalizeDocumentKind(kind));
  const next: SignSlot = {
    id: "employee",
    role: "employee",
    page: piece.page,
    xPt: piece.xPt,
    yPt: piece.yPt,
    wPt: piece.wPt,
    hPt: piece.hPt,
  };
  return [next, ...base.filter((slot) => slot.role !== "employee")];
}

export async function saveEsignStampLayout(
  requestId: string,
  layout: StampLayout,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = requestId.trim();
  if (!id) return { ok: false, error: "not_found" };
  const parsed = parseStampLayout(layout);
  if (!parsed) return { ok: false, error: "invalid_stamp_layout" };

  const gate = await requireMutationAuth();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!mayPlace(gate.session)) return { ok: false, error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { ok: false, error: "not_configured" };
  const ref = db.collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const row = snap.data() ?? {};
  if (String(row.status ?? "") !== "signed") return { ok: false, error: "not_signed" };

  const documentKey = textOrNull(row.document_storage_key);
  const signatureKey = textOrNull(row.signature_storage_key);
  if (!documentKey) return { ok: false, error: "source_document_unavailable" };
  if (!signatureKey) return { ok: false, error: "signature_unavailable" };

  const [sourceFile, signatureFile] = await Promise.all([
    readEsignObject(documentKey),
    readEsignObject(signatureKey),
  ]);
  if (!sourceFile) return { ok: false, error: "source_document_unavailable" };
  if (!signatureFile) return { ok: false, error: "signature_unavailable" };
  if (sourceFile.bytes.byteLength > MAX_SOURCE_BYTES) return { ok: false, error: "source_too_large" };
  if (signatureFile.bytes.byteLength > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: "signature_too_large" };
  }

  const sourceKind = sniff(sourceFile.bytes);
  if (sourceKind === "unsupported") return { ok: false, error: "unsupported_source_type" };
  const signatureKind = sniff(signatureFile.bytes);
  if (signatureKind !== "png" && signatureKind !== "jpeg") {
    return { ok: false, error: "unsupported_signature_type" };
  }
  const sourceDefect = validateImage(sourceFile.bytes, sourceKind);
  if (sourceDefect) return { ok: false, error: "malformed_source_image" };
  const signatureDefect = validateImage(signatureFile.bytes, signatureKind);
  if (signatureDefect) return { ok: false, error: "malformed_signature_image" };

  const labels = stampLabelsFromRow(row);
  const placement = placementFromLayout(parsed, labels);
  if (!placement) return { ok: false, error: "invalid_stamp_layout" };

  let pdfBytes: Uint8Array;
  try {
    const composed = await composeSignedPdf({
      sourceBytes: sourceFile.bytes,
      sourceKind,
      signatureBytes: signatureFile.bytes,
      signatureKind,
      captions: [labels.name, labels.date, labels.code],
      kind: row.document_kind,
      persistedSlots: row.signature_slots,
      placement,
    });
    pdfBytes = composed.pdfBytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "compose_failed";
    return { ok: false, error: message || "compose_failed" };
  }

  const requestCode = textOrNull(row.request_code) ?? id;
  const outputKey = `signed/${id}/${requestCode}-signed.pdf`;
  const stored = await putEsignObject(outputKey, pdfBytes, "application/pdf");
  if (!stored.ok) return { ok: false, error: stored.error };

  const signature = parsed.pieces.find((piece) => piece.id === "signature");
  if (!signature) return { ok: false, error: "invalid_stamp_layout" };
  const now = Timestamp.now();
  await ref.update({
    stamp_layout: { pieces: parsed.pieces },
    stamp_layout_at: now,
    signature_slots: withEmployeeSlot(row.document_kind, row.signature_slots, signature),
    signed_document_storage_key: outputKey,
    signed_document_generated_at: now,
    signed_document_error: null,
    updated_at: now,
  });

  await logAdminMutation({
    action: "update",
    entityType: "esign_requests",
    entityId: id,
    routeName: "esign.stamp-layout",
    after: {
      pieces: parsed.pieces.map((piece) => ({
        id: piece.id,
        page: piece.page,
        xPt: piece.xPt,
        yPt: piece.yPt,
        wPt: piece.wPt,
        hPt: piece.hPt,
      })),
    },
  });

  return { ok: true };
}

/** Rewrites the printed sheet, stores a new source PDF, then recomposes the signed copy. */
export async function saveEsignFormSheet(
  requestId: string,
  html: string,
  layout: StampLayout,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = requestId.trim();
  if (!id) return { ok: false, error: "not_found" };
  const clean = sanitizeEditedSheetHtml(html);
  if (!clean) return { ok: false, error: "invalid_sheet" };

  const gate = await requireMutationAuth();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!mayPlace(gate.session)) return { ok: false, error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { ok: false, error: "not_configured" };
  const ref = db.collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const row = snap.data() ?? {};
  if (String(row.status ?? "") !== "signed") return { ok: false, error: "not_signed" };

  const formKey = `edited/${id}/form.pdf`;
  let browser: Awaited<ReturnType<typeof launchEsignBrowser>> | null = null;
  try {
    browser = await launchEsignBrowser();
    const pdf = await renderStoredSheetPdf(clean, browser);
    const stored = await putEsignObject(formKey, pdf, "application/pdf");
    if (!stored.ok) return { ok: false, error: stored.error };
  } catch {
    return { ok: false, error: "form_render_failed" };
  } finally {
    await browser?.close();
  }

  const now = Timestamp.now();
  await ref.update({
    sheet_html: clean,
    document_storage_key: formKey,
    updated_at: now,
  });
  await logAdminMutation({
    action: "update",
    entityType: "esign_requests",
    entityId: id,
    routeName: "esign.form-sheet",
    after: { document_storage_key: formKey, html_chars: clean.length },
  });

  return saveEsignStampLayout(id, layout);
}

function fieldValuesOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

function blankSnapshot(name: string, employeeId: string): EsignEmployeeSnapshot {
  return {
    company_name: "",
    employee_name: name,
    employee_id: employeeId,
    driver_code: employeeId,
    civil_id: null,
    joined_at: null,
    accommodation: null,
    zone: null,
    project: null,
    nationality: null,
  };
}

function templateFields(
  docs: ReadonlyArray<{ data: () => Record<string, unknown> }>,
): FilledSheetField[] {
  return docs
    .map((doc) => {
      const data = doc.data();
      const options = Array.isArray(data.options) ? data.options.map((item) => String(item)) : [];
      return {
        sort: Number(data.sort_order ?? 0),
        field: {
          field_key: String(data.field_key ?? ""),
          label_en: String(data.label_en ?? ""),
          label_ar: data.label_ar != null ? String(data.label_ar) : null,
          section_key: String(data.section_key ?? "document"),
          source_kind: String(data.source_kind ?? "entry"),
          options,
        },
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map((row) => row.field);
}

function sheetNeedsRefresh(html: string): boolean {
  if (html.includes("esign-sheet-edited")) return false;
  return html.includes("Form Ref:") || html.includes("Page 1 of 1");
}

/** The filled client sheet frozen on the request. Rebuilds once when an older row has none. */
export async function loadEsignStampSheet(
  requestId: string,
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const id = requestId.trim();
  if (!id) return { ok: false, error: "not_found" };
  const gate = await requireMutationAuth();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!mayPlace(gate.session)) return { ok: false, error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { ok: false, error: "not_configured" };
  const ref = db.collection(COLLECTIONS.esignRequests).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "not_found" };
  const row = snap.data() ?? {};
  const stored = textOrNull(row.sheet_html);
  if (stored && !sheetNeedsRefresh(stored)) return { ok: true, html: stored };

  const templateId = textOrNull(row.template_id);
  if (!templateId) {
    if (stored) return { ok: true, html: stored };
    return { ok: false, error: "template_missing" };
  }
  const templateSnap = await db.collection(COLLECTIONS.esignTemplates).doc(templateId).get();
  if (!templateSnap.exists) return { ok: false, error: "template_missing" };
  const template = templateSnap.data() ?? {};
  const fieldsSnap = await db
    .collection(COLLECTIONS.esignTemplateFields)
    .where("template_id", "==", templateId)
    .get();
  const snapshot =
    snapshotFromStored(row.employee_snapshot) ??
    blankSnapshot(textOrNull(row.signer_display_name) ?? "", textOrNull(row.employee_id) ?? "");
  const html = filledEsignSheetHtml({
    template: {
      document_kind: row.document_kind ?? template.document_kind,
      header_en: String(template.header_en ?? ""),
      header_ar: String(template.header_ar ?? ""),
      body_en: String(template.body_en ?? ""),
      body_ar: String(template.body_ar ?? ""),
      declaration_en: String(template.declaration_en ?? ""),
      declaration_ar: String(template.declaration_ar ?? ""),
      fields: templateFields(
        fieldsSnap.docs.map((doc) => ({
          data: () => doc.data() as Record<string, unknown>,
        })),
      ),
    },
    snapshot,
    fieldValues: fieldValuesOf(row.field_values),
    description: textOrNull(row.description) ?? "",
    requestCode: textOrNull(row.request_code) ?? "",
  });
  if (!html.includes('data-slot-role="employee"')) return { ok: false, error: "template_missing" };
  await ref.update({ sheet_html: html });
  return { ok: true, html };
}
