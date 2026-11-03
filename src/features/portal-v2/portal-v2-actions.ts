"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { COLLECTIONS } from "@/lib/firebase/db";
import { callAdminFunction } from "@/lib/firebase/callable";
import { staffDb } from "@/lib/firebase/staff-db";
import { resolvePortalProject } from "@/features/client-portal/portal-access";

export type PortalOnboardingRow = {
  id: string;
  name: string;
  startDate: string;
  hasStartDate: boolean;
  statusKey: string;
};

export type PortalDocAlertRow = {
  id: string;
  name: string;
  docType: string;
  expiresAt: string;
  expired: boolean;
};

export type PortalExtras = {
  onboarding: PortalOnboardingRow[];
  docAlerts: PortalDocAlertRow[];
};

const ONBOARDING_CAP = 300;
const DOC_CAP = 200;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ymd(value: unknown): string {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) ? raw.slice(0, 10) : "";
}

async function portalProject(requested: string | undefined): Promise<string | null> {
  const session = await getSessionUser();
  if (!session || (!session.isSuperAdmin && !session.permissions.has("client_portal.view"))) return null;
  const resolved = resolvePortalProject(session, requested);
  return "error" in resolved ? null : resolved.projectKey;
}

function addDays(ymdValue: string, days: number): string {
  const date = new Date(`${ymdValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The two panels the client dashboard shows beside the live numbers: riders still
 * onboarding for this client, and documents that expire inside the next 30 days.
 * Both are read from the intake sheet the employee flow already writes, capped so
 * one open cannot scan the whole collection.
 */
export async function fetchPortalExtras(input: { project?: string }): Promise<PortalExtras> {
  const project = await portalProject(input.project);
  if (!project) return { onboarding: [], docAlerts: [] };
  const db = await staffDb();
  if (!db) return { onboarding: [], docAlerts: [] };

  const today = kuwaitTodayYmd();
  const horizon = addDays(today, 30);

  const [intakeSnap, expiringSnap, expiredSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.driverIntakes)
      .where("project_key", "==", project)
      .limit(ONBOARDING_CAP)
      .get(),
    db
      .collection(COLLECTIONS.documentTracking)
      .where("expires_at", ">=", today)
      .where("expires_at", "<=", horizon)
      .limit(DOC_CAP)
      .get(),
    db
      .collection(COLLECTIONS.documentTracking)
      .where("expires_at", "<", today)
      .limit(50)
      .get(),
  ]);

  const onboarding: PortalOnboardingRow[] = [];
  const intakeProject = new Map<string, string>();
  for (const doc of intakeSnap.docs) {
    const row = doc.data() ?? {};
    if (row.archived_at != null) continue;
    const linked = text(row.linked_profile_id);
    const workflow = text(row.workflow_status) || "draft";
    if (linked && workflow === "approved") continue;
    const start = ymd(row.work_start_date) || ymd(row.joining_date);
    intakeProject.set(doc.id, project);
    onboarding.push({
      id: doc.id,
      name: text(row.full_name) || text(row.employee_id) || doc.id,
      startDate: start,
      hasStartDate: Boolean(start),
      statusKey: workflow,
    });
  }
  onboarding.sort((left, right) => {
    if (left.hasStartDate !== right.hasStartDate) return left.hasStartDate ? -1 : 1;
    return left.startDate.localeCompare(right.startDate);
  });

  const tracking = [...expiringSnap.docs, ...expiredSnap.docs];
  const intakeIds = [...new Set(tracking.map((doc) => text(doc.get("intake_id"))).filter(Boolean))];
  const names = new Map<string, string>();
  const intakeProjects = new Map<string, string>();
  if (intakeIds.length > 0) {
    const refs = intakeIds.slice(0, 250).map((id) => db.collection(COLLECTIONS.driverIntakes).doc(id));
    const rows = await db.getAll(...refs);
    for (const row of rows) {
      const data = row.data() ?? {};
      names.set(row.id, text(data.full_name) || text(data.employee_id) || row.id);
      intakeProjects.set(row.id, text(data.project_key));
    }
  }

  const docAlerts: PortalDocAlertRow[] = [];
  const seen = new Set<string>();
  for (const doc of tracking) {
    const row = doc.data() ?? {};
    const intakeId = text(row.intake_id);
    if (!intakeId) continue;
    const owner = intakeProjects.get(intakeId);
    if (owner && owner !== project) continue;
    if (!owner) continue;
    const expiresAt = ymd(row.expires_at);
    if (!expiresAt) continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    docAlerts.push({
      id: doc.id,
      name: names.get(intakeId) ?? intakeId,
      docType: text(row.doc_type) || "document",
      expiresAt,
      expired: expiresAt < today,
    });
  }
  docAlerts.sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));
  intakeProject.clear();

  return { onboarding, docAlerts: docAlerts.slice(0, 12) };
}

export type PortalDirectoryRow = {
  projectKey: string;
  riders: number;
};

/**
 * The Clients tab needs one number the dashboard RPC does not answer: how many
 * riders each project holds. One capped page per project reads `filtered_total`.
 */
export async function fetchPortalDirectory(): Promise<{ rows: PortalDirectoryRow[]; failed: boolean }> {
  const session = await getSessionUser();
  if (!session || session.accessKind === "partner") return { rows: [], failed: true };
  if (!session.isSuperAdmin && !session.permissions.has("client_portal.view")) {
    return { rows: [], failed: true };
  }
  const keys = ["keeta", "americana", "unassigned"] as const;
  const results = await Promise.all(
    keys.map((key) =>
      callAdminFunction<{ filtered_total?: number }>("admin_list_drivers_page", {
        p_tab: "all",
        p_limit: 1,
        p_offset: 0,
        p_project: key,
      }),
    ),
  );
  const rows: PortalDirectoryRow[] = keys.map((key, index) => ({
    projectKey: key,
    riders: typeof results[index]?.data?.filtered_total === "number" ? results[index]!.data!.filtered_total! : 0,
  }));
  return { rows, failed: results.some((result) => Boolean(result.error)) };
}
