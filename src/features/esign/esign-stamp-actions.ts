"use server";

import { Timestamp } from "firebase-admin/firestore";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  MAX_SIGNATURE_BYTES,
  MAX_SOURCE_BYTES,
  STAFF_SLOT_MISSING,
  composeSignedPdf,
  placementFromLayout,
  resolveStaffStampSlots,
  signedDocumentSourceHash,
  sniff,
  validateImage,
  type ComposeStamp,
} from "../../../functions/src/rpcs/esign-compose-logic";
import { normalizeDocumentKind } from "./document-kind";
import { sanitizeEditedSheetHtml } from "./esign-sheet-edit";
import { putEsignObject, readEsignObject } from "./esign-r2";
import {
  filledEsignSheetHtml,
  snapshotFromStored,
  type FilledSheetField,
} from "./render/esign-filled-sheet";
import { ESIGN_SHEET_RENDER_VERSION } from "./render/esign-document-html";
import type { EsignEmployeeSnapshot } from "./render/esign-placeholders";
import {
  formatStampInstant,
  parseStampLayout,
  type StampLayout,
  type StampPiece,
  type StampPieceLabels,
} from "./esign-stamp-layout";
import { launchEsignBrowser, renderStoredSheetPdf } from "./render/esign-pdf-renderer";
import { measureEsignSlots } from "./render/esign-slot-measure";
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

/**
 * The measured boxes this compose may trust.
 *
 * Null means "ignore them": a sheet built before the current render version was
 * measured against a layout this build no longer draws, so the kind's printed
 * geometry is the honest fallback — which is also what fills a role the old
 * array never had (the loan sheet's missing HR line).
 */
function sheetSlotsForCompose(
  version: unknown,
  persisted: unknown,
): unknown {
  const renderVersion = typeof version === "number" ? version : null;
  if (renderVersion === null || renderVersion < ESIGN_SHEET_RENDER_VERSION) return null;
  return persisted;
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
  const signaturePiece = parsed.pieces.find((piece) => piece.id === "signature");
  if (!signaturePiece) return { ok: false, error: "invalid_stamp_layout" };

  // The manager boxes on the printed sheet belong to the staff rows that have
  // signed, in `sort_order`, not to the rider. A recompose that skipped them
  // would erase every counter-signature already on the document.
  const signerSnap = await db
    .collection(COLLECTIONS.esignRequestSigners)
    .where("request_id", "==", id)
    .get();
  const signedStaff = signerSnap.docs.flatMap((doc) => {
    const signer = doc.data();
    const key = textOrNull(signer.signature_storage_key);
    if (signer.status !== "signed" || signer.staff_user_id == null || !key) return [];
    return [
      {
        id: doc.id,
        sortOrder: Number.isFinite(Number(signer.sort_order)) ? Number(signer.sort_order) : 0,
        signatureKey: key,
        signedAt: formatStampInstant(signer.signed_at),
        displayName: textOrNull(signer.signer_display_name) ?? textOrNull(signer.staff_contact) ?? "",
      },
    ];
  });
  // Mirrors the Cloud Function: a `signature_slots` array measured on an older
  // sheet is ignored, and a role with no box at all is a refusal rather than a
  // silently thinner document.
  const persistedSlots = sheetSlotsForCompose(row.sheet_render_version, row.signature_slots);
  let assignments: Array<
    { id: string; sortOrder: number; signatureKey: string; signedAt: string; displayName: string } & {
      slot: SignSlot;
    }
  > = [];
  try {
    assignments = resolveStaffStampSlots({
      kind: row.document_kind,
      persistedSlots,
      signers: signedStaff,
    }).assignments;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(STAFF_SLOT_MISSING)) return { ok: false, error: STAFF_SLOT_MISSING };
    throw error;
  }
  if (signedStaff.length > assignments.length) {
    console.warn("esign stamp: staff signatures past the printed slots", {
      requestId: id,
      signed: signedStaff.length,
      slots: assignments.length,
    });
  }
  const staffBySigner = new Map(signedStaff.map((signer) => [signer.id, signer]));
  const staffFiles: Array<{
    assignment: (typeof assignments)[number];
    bytes: Uint8Array | null;
    kind: "png" | "jpeg" | null;
  }> = await Promise.all(
    assignments.map(async (assignment) => {
      const file = await readEsignObject(assignment.signatureKey);
      if (!file || file.bytes.byteLength > MAX_SIGNATURE_BYTES) {
        return { assignment, bytes: null, kind: null };
      }
      const kind = sniff(file.bytes);
      if (kind !== "png" && kind !== "jpeg") {
        return { assignment, bytes: null, kind: null };
      }
      if (validateImage(file.bytes, kind)) {
        return { assignment, bytes: null, kind: null };
      }
      return { assignment, bytes: file.bytes, kind };
    }),
  );
  const missingStaff = staffFiles.find((entry) => !entry.bytes);
  if (missingStaff) return { ok: false, error: "staff_signature_unavailable" };

  const sourceHash = signedDocumentSourceHash({
    documentKey,
    employeeSignatureKey: signatureKey,
    employeeSignedAt: formatStampInstant(row.signed_at),
    stampLayout: parsed,
    signatureSlots: withEmployeeSlot(row.document_kind, row.signature_slots, signaturePiece),
    staffSlots: assignments.map((assignment) => ({
      id: assignment.id,
      role: assignment.slot.role,
      page: assignment.slot.page,
      xPt: assignment.slot.xPt,
      yPt: assignment.slot.yPt,
      wPt: assignment.slot.wPt,
      hPt: assignment.slot.hPt,
    })),
    sheetRenderVersion:
      typeof row.sheet_render_version === "number" ? row.sheet_render_version : null,
    staff: assignments.map((assignment) => ({
      id: assignment.id,
      signatureKey: assignment.signatureKey,
      signedAt: staffBySigner.get(assignment.id)?.signedAt ?? "",
    })),
  });

  const stamps: ComposeStamp[] = [
    {
      bytes: signatureFile.bytes,
      kind: signatureKind,
      slot: placement.signature,
      captions: [labels.name, labels.date, labels.code],
      placement,
    },
  ];
  for (const entry of staffFiles) {
    if (!entry.bytes || !entry.kind) continue;
    const signer = staffBySigner.get(entry.assignment.id);
    stamps.push({
      bytes: entry.bytes,
      kind: entry.kind,
      slot: entry.assignment.slot,
      captions: [signer?.displayName ?? "", signer?.signedAt ?? ""],
      reserveCaption: true,
    });
  }

  let pdfBytes: Uint8Array;
  try {
    const composed = await composeSignedPdf({
      sourceBytes: sourceFile.bytes,
      sourceKind,
      captions: [labels.name, labels.date, labels.code],
      kind: row.document_kind,
      persistedSlots,
      placement,
      stamps,
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

  const signature = signaturePiece;
  const now = Timestamp.now();
  await ref.update({
    stamp_layout:
      parsed.removed && parsed.removed.length > 0
        ? { pieces: parsed.pieces, removed: parsed.removed }
        : { pieces: parsed.pieces },
    stamp_layout_at: now,
    signature_slots: withEmployeeSlot(row.document_kind, row.signature_slots, signature),
    signed_document_storage_key: outputKey,
    signed_document_generated_at: now,
    signed_document_source_hash: sourceHash,
    signed_document_pending: false,
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
      removed: parsed.removed ?? [],
    },
  });

  return { ok: true };
}

/**
 * Rewrites the printed sheet. A signed request also gets a new source PDF and
 * a recomposed signed copy; an unsigned request only stores the edited HTML.
 */
export async function saveEsignFormSheet(
  requestId: string,
  html: string,
  _layout: StampLayout,
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
  const status = String(row.status ?? "");
  // A signed sheet is evidence of what the rider agreed to, and a declined or
  // cancelled one is an archived record. Only an unsigned row may be rewritten.
  if (!["pending", "draft", "sent", "viewed"].includes(status)) {
    return { ok: false, error: "document_locked" };
  }

  const now = Timestamp.now();
  // The edit reflows the sheet, so the boxes measured on the old one no longer
  // describe it. Measure the saved HTML before storing it — the same step a
  // regenerated sheet takes — and keep the previous boxes if that fails.
  let measuredSlots: SignSlot[] = [];
  let browser: Awaited<ReturnType<typeof launchEsignBrowser>> | null = null;
  try {
    browser = await launchEsignBrowser();
    measuredSlots = await measureEsignSlots(clean, browser);
  } catch {
    measuredSlots = [];
  } finally {
    await browser?.close();
  }

  await ref.update({
    sheet_html: clean,
    sheet_render_version: ESIGN_SHEET_RENDER_VERSION,
    ...(measuredSlots.length > 0 ? { signature_slots: measuredSlots } : {}),
    updated_at: now,
  });
  await logAdminMutation({
    action: "update",
    entityType: "esign_requests",
    entityId: id,
    routeName: "esign.form-sheet",
    after: { html_chars: clean.length, unsigned: true },
  });
  // A row that somehow already carries a signed copy recomposes, so the archived
  // PDF and the sheet an operator just corrected cannot disagree. Unsigned rows
  // (the only ones this action accepts) skip it.
  if (textOrNull(row.signed_document_storage_key) != null) {
    try {
      await callAdminFunction(
        "esign_compose_signed_document",
        { p_request_id: id, p_force: true },
        { timeoutMs: 120_000 },
      );
    } catch {
      // The compose records its own failure on `signed_document_error`.
    }
  }
  // The stamp layout only exists once the rider has signed; an unsigned save
  // must not report the signed-only layout gate as the reason it failed.
  return { ok: true };
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

function sheetNeedsRefresh(html: string, version: number): boolean {
  if (html.includes("esign-sheet-edited")) return false;
  if (version !== ESIGN_SHEET_RENDER_VERSION) return true;
  return html.includes("Form Ref:") || html.includes("Page 1 of 1");
}

type SheetStatusTone = "ok" | "wait" | "red";

/**
 * The frozen sheet prints a status chip. Its wording has to agree with the
 * status panel beside it, so the chip is rewritten on read — the stored HTML
 * itself stays untouched evidence.
 */
function withSheetStatus(html: string, label: string, tone: SheetStatusTone): string {
  return html.replace(
    /<span class="chip chip--(?:ok|wait|red)">[^<]*<\/span>/,
    `<span class="chip chip--${tone}">${label}</span>`,
  );
}

function sheetStatus(title: string, tone: SheetStatusTone) {
  return { title, tone };
}

async function requestSheetStatus(
  db: NonNullable<Awaited<ReturnType<typeof staffDb>>>,
  id: string,
  row: Record<string, unknown>,
): Promise<{ title: string; tone: SheetStatusTone }> {
  const status = textOrNull(row.status) ?? "pending";
  if (status === "signed") {
    const signerSnap = await db
      .collection(COLLECTIONS.esignRequestSigners)
      .where("request_id", "==", id)
      .get();
    const awaiting = signerSnap.docs.some((doc) => {
      const signer = doc.data();
      return (
        typeof signer.staff_user_id === "string" &&
        signer.staff_user_id.trim() !== "" &&
        signer.status === "pending"
      );
    });
    return awaiting
      ? sheetStatus("Awaiting counter-signature", "wait")
      : sheetStatus("Signed", "ok");
  }
  if (status === "declined") return sheetStatus("Declined", "red");
  if (status === "cancelled") return sheetStatus("Cancelled", "red");
  if (status === "expired") return sheetStatus("Expired", "red");
  return sheetStatus("Awaiting signature", "wait");
}


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
  const storedVersion =
    typeof row.sheet_render_version === "number" ? row.sheet_render_version : 0;
  const signed = textOrNull(row.status) === "signed";
  // A signed row's sheet is the evidence attached to the signature. Only an
  // unsigned row is ever rebuilt from the current layout code.
  if (stored && (signed || !sheetNeedsRefresh(stored, storedVersion))) {
    const chip = await requestSheetStatus(db, id, row);
    return { ok: true, html: withSheetStatus(stored, chip.title, chip.tone) };
  }

  const templateId = textOrNull(row.template_id);
  if (!templateId) {
    if (stored) {
      const chip = await requestSheetStatus(db, id, row);
      return { ok: true, html: withSheetStatus(stored, chip.title, chip.tone) };
    }
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
  await ref.update({
    sheet_html: html,
    sheet_render_version: ESIGN_SHEET_RENDER_VERSION,
  });
  const chip = await requestSheetStatus(db, id, row);
  return { ok: true, html: withSheetStatus(html, chip.title, chip.tone) };
}

/**
 * Rebuilds an unsigned request from its template after a layout change.
 *
 * The sent PDF is rebuilt too: the rider downloads `document_storage_key`, so
 * updating only `sheet_html` would leave the old design in the app inbox.
 */
export async function regenerateEsignSheet(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
  const status = String(row.status ?? "");
  if (status === "signed") return { ok: false, error: "signed_locked" };
  if (!["pending", "draft", "sent", "viewed"].includes(status)) {
    return { ok: false, error: "not_editable" };
  }

  const templateId = textOrNull(row.template_id);
  if (!templateId) return { ok: false, error: "template_missing" };
  const templateSnap = await db.collection(COLLECTIONS.esignTemplates).doc(templateId).get();
  if (!templateSnap.exists) return { ok: false, error: "template_missing" };
  const template = templateSnap.data() ?? {};
  const fieldsSnap = await db
    .collection(COLLECTIONS.esignTemplateFields)
    .where("template_id", "==", templateId)
    .get();
  const snapshot =
    snapshotFromStored(row.employee_snapshot) ??
    blankSnapshot(
      textOrNull(row.signer_display_name) ?? "",
      textOrNull(row.employee_id) ?? "",
    );
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
  if (!html.includes('data-slot-role="employee"')) {
    return { ok: false, error: "template_missing" };
  }

  const storageKey = `regenerated/${id}/document.pdf`;
  let browser: Awaited<ReturnType<typeof launchEsignBrowser>> | null = null;
  let measuredSlots: SignSlot[] = [];
  try {
    browser = await launchEsignBrowser();
    const pdf = await renderStoredSheetPdf(html, browser);
    measuredSlots = await measureEsignSlots(html, browser);
    const stored = await putEsignObject(storageKey, pdf, "application/pdf");
    if (!stored.ok) return { ok: false, error: stored.error };
  } catch {
    return { ok: false, error: "render_failed" };
  } finally {
    await browser?.close();
  }

  const now = Timestamp.now();
  await ref.update({
    sheet_html: html,
    sheet_render_version: ESIGN_SHEET_RENDER_VERSION,
    document_storage_key: storageKey,
    ...(measuredSlots.length > 0 ? { signature_slots: measuredSlots } : {}),
    updated_at: now,
  });
  await logAdminMutation({
    action: "update",
    entityType: "esign_requests",
    entityId: id,
    routeName: "esign.regenerate-sheet",
    after: { html_chars: html.length, document_storage_key: storageKey },
  });
  return { ok: true };
}
