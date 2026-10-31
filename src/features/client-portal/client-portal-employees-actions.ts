"use server";

import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { partnerProjectMatches } from "@/lib/auth/staff-access";
import { DOCUMENT_TYPES, type DriverDocumentType } from "@/features/drivers/types";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { listExistingDriverDocuments, listExtraDriverDocuments } from "@/lib/storage/driver-documents";
import { resolvePortalProject } from "./portal-access";

const PAGE = 5000;
const CAP = 20000;

export type ClientPortalEmployee = {
  id: string;
  mgId: string;
  clientId: string;
  fullName: string;
  civilId: string;
  status: string;
};

export type ClientPortalDocument = {
  id: string;
  labelKey: DriverDocumentType | null;
  label: string;
  number: "—";
  expiry: string | null;
  status: "valid" | "expired";
  signedUrl: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128 || id.includes("/") || id.includes("\\")) return "";
  return id;
}

async function portalSession(projectArg: string | undefined) {
  const session = await getSessionUser();
  if (!session || (!session.isSuperAdmin && !session.permissions.has("client_portal.view"))) return null;
  const resolved = resolvePortalProject(session, projectArg);
  if ("error" in resolved) return null;
  return { locked: resolved.projectKey };
}

async function loadIntake(intakeId: string): Promise<{ project: unknown; linkedProfileId: string | null } | null> {
  const db = await staffDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.driverIntakes).doc(intakeId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const linked = text(data.linked_profile_id);
  return { project: data.project_key, linkedProfileId: linked || null };
}

function narrowEmployee(row: Record<string, unknown>): ClientPortalEmployee | null {
  const id = text(row.id);
  if (!id) return null;
  const status = text(row.employee_status_key) || text(row.account_status);
  return {
    id,
    mgId: text(row.mg_id),
    clientId: text(row.client_id),
    fullName: text(row.full_name),
    civilId: text(row.civil_id),
    status,
  };
}

function expiryStatus(expiresAt: string | null): "valid" | "expired" {
  const day = expiresAt?.slice(0, 10) ?? "";
  if (day && day < kuwaitTodayYmd()) return "expired";
  return "valid";
}

export async function fetchClientPortalEmployees(input: {
  project?: string;
}): Promise<{ rows: ClientPortalEmployee[]; failed: boolean }> {
  const gate = await portalSession(input.project);
  if (!gate) return { rows: [], failed: true };
  const rows: ClientPortalEmployee[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total && offset < CAP) {
    const { data, error } = await callAdminFunction("admin_list_drivers_page", {
      p_tab: "all",
      p_limit: PAGE,
      p_offset: offset,
      p_sort_key: "name",
      p_sort_dir: "asc",
      p_project: gate.locked,
    });
    if (error) return { rows: [], failed: true };
    const payload = (data ?? {}) as { rows?: unknown[]; filtered_total?: number };
    const page = Array.isArray(payload.rows) ? payload.rows : [];
    if (typeof payload.filtered_total === "number") total = payload.filtered_total;
    if (page.length === 0) break;
    for (const raw of page) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      if (!partnerProjectMatches(record.project_key, gate.locked)) continue;
      const employee = narrowEmployee(record);
      if (employee) rows.push(employee);
    }
    offset += page.length;
    if (page.length < PAGE) break;
  }
  return { rows, failed: false };
}

export async function fetchClientPortalDocuments(input: {
  intakeId: string;
  project?: string;
}): Promise<{ documents: ClientPortalDocument[]; failed: boolean }> {
  const gate = await portalSession(input.project);
  const intakeId = cleanId(input.intakeId);
  if (!gate || !intakeId) return { documents: [], failed: true };
  const intake = await loadIntake(intakeId);
  if (!intake || !partnerProjectMatches(intake.project, gate.locked)) return { documents: [], failed: true };
  try {
    const [fixed, extra] = await Promise.all([
      listExistingDriverDocuments(intakeId, intake.linkedProfileId),
      listExtraDriverDocuments(intakeId, intake.linkedProfileId),
    ]);
    const documents: ClientPortalDocument[] = [];
    for (const labelKey of DOCUMENT_TYPES) {
      const file = fixed[labelKey];
      if (!file?.signedUrl) continue;
      const expiry = file.expiry?.expiresAt?.slice(0, 10) || null;
      documents.push({
        id: labelKey,
        labelKey,
        label: labelKey,
        number: "—",
        expiry,
        status: expiryStatus(expiry),
        signedUrl: file.signedUrl,
      });
    }
    for (const file of extra) {
      if (!file.signedUrl) continue;
      documents.push({
        id: file.id,
        labelKey: null,
        label: file.title || "—",
        number: "—",
        expiry: null,
        status: "valid",
        signedUrl: file.signedUrl,
      });
    }
    await logAdminActivity({
      action: "view",
      entityType: "driver_document",
      entityId: intakeId,
      pagePath: "/client-portal/employees",
      context: {
        project: gate.locked,
        labels: documents.map((doc) => doc.labelKey ?? doc.label),
      },
    });
    return { documents, failed: false };
  } catch {
    return { documents: [], failed: true };
  }
}

export async function logClientPortalDocument(input: {
  intakeId: string;
  label: string;
  kind: "view" | "read";
  project?: string;
}): Promise<{ ok: boolean }> {
  const gate = await portalSession(input.project);
  const intakeId = cleanId(input.intakeId);
  if (!gate || !intakeId) return { ok: false };
  const intake = await loadIntake(intakeId);
  if (!intake || !partnerProjectMatches(intake.project, gate.locked)) return { ok: false };
  const kind = input.kind === "read" ? "read" : "view";
  await logAdminActivity({
    action: kind,
    entityType: "driver_document",
    entityId: intakeId,
    pagePath: "/client-portal/employees",
    context: { project: gate.locked, label: input.label.slice(0, 120) },
  });
  return { ok: true };
}
