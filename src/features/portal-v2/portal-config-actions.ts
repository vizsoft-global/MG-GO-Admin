"use server";

import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { isPortalProjectKey, normalizePortalConfig, type PortalConfig } from "./portal-config";

async function allowed(): Promise<boolean> {
  const session = await getSessionUser();
  if (!session || session.accessKind === "partner") return false;
  return session.isSuperAdmin || session.permissions.has("client_portal.view");
}

async function store() {
  return staffDb();
}

function ymd(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

/** Every configured portal. The Clients tab reads this. */
export async function fetchPortalConfigs(): Promise<{ rows: PortalConfig[]; failed: boolean }> {
  if (!(await allowed())) return { rows: [], failed: true };
  const db = await store();
  if (!db) return { rows: [], failed: true };
  try {
    const snap = await db.collection(COLLECTIONS.clientPortals).limit(50).get();
    const rows = snap.docs
      .map((doc) => normalizePortalConfig(doc.id, doc.data()))
      .sort((left, right) => left.clientName.localeCompare(right.clientName));
    return { rows, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

export async function fetchPortalConfig(input: { projectKey: string }): Promise<{ row: PortalConfig | null }> {
  const projectKey = input.projectKey.trim().toLowerCase();
  if (!isPortalProjectKey(projectKey)) return { row: null };
  if (!(await allowed())) return { row: null };
  const db = await store();
  if (!db) return { row: null };
  const snap = await db.collection(COLLECTIONS.clientPortals).doc(projectKey).get();
  if (!snap.exists) return { row: null };
  return { row: normalizePortalConfig(projectKey, snap.data()) };
}

/**
 * Upsert one portal. The document id is the project key, which is what keeps
 * "a project belongs to one client only" true without a second lookup.
 */
export async function savePortalConfig(input: {
  config: PortalConfig;
  status?: PortalConfig["status"];
}): Promise<{ error?: "not_authorized" | "invalid" | "save_failed" }> {
  if (!(await allowed())) return { error: "not_authorized" };
  const projectKey = input.config.projectKey.trim().toLowerCase();
  if (!isPortalProjectKey(projectKey)) return { error: "invalid" };
  const clientName = input.config.clientName.trim();
  if (!clientName) return { error: "invalid" };
  const db = await store();
  if (!db) return { error: "save_failed" };

  const ref = db.collection(COLLECTIONS.clientPortals).doc(projectKey);
  const before = await ref.get();
  const status = input.status ?? input.config.status;
  const payload = {
    project_key: projectKey,
    client_name: clientName,
    client_code: input.config.clientCode.trim().toUpperCase(),
    account_manager: input.config.accountManager.trim(),
    contracted_headcount: Math.max(0, Math.round(input.config.contractedHeadcount)),
    contract_start: ymd(input.config.contractStart),
    contract_end: ymd(input.config.contractEnd),
    logo_url: input.config.logoUrl.trim(),
    status,
    sections: input.config.sections,
    documents: input.config.documents,
    mask_civil_id: input.config.maskCivilId,
    allow_downloads: input.config.allowDownloads,
    allow_bulk: input.config.allowBulk,
    watermark: input.config.watermark,
    users: input.config.users.slice(0, 50).map((user) => ({
      id: user.id || user.email.toLowerCase(),
      name: user.name.trim() || user.email,
      email: user.email.trim(),
      role: user.role,
    })),
    two_step: input.config.twoStep,
    idle_sign_out: input.config.idleSignOut,
    updated_at: new Date().toISOString(),
    updated_by: (await getSessionUser())?.id ?? null,
  };

  try {
    await ref.set(payload, { merge: true });
  } catch {
    return { error: "save_failed" };
  }
  await logAdminActivity({
    action: before.exists ? "update" : "create",
    entityType: "client_portal",
    entityId: projectKey,
    pagePath: "/client-portal-v2",
    before: before.exists ? ((before.data() ?? {}) as Record<string, unknown>) : null,
    after: payload as unknown as Record<string, unknown>,
    context: { project: projectKey, status },
  });
  return {};
}

/** Persist only the user list, for the Users & access tab. */
export async function savePortalUsers(input: {
  projectKey: string;
  users: PortalConfig["users"];
}): Promise<{ error?: "not_authorized" | "invalid" | "save_failed" }> {
  if (!(await allowed())) return { error: "not_authorized" };
  const projectKey = input.projectKey.trim().toLowerCase();
  if (!isPortalProjectKey(projectKey)) return { error: "invalid" };
  const db = await store();
  if (!db) return { error: "save_failed" };
  const users = input.users.slice(0, 50).map((user) => ({
    id: user.id || user.email.toLowerCase(),
    name: user.name.trim() || user.email,
    email: user.email.trim(),
    role: user.role,
  }));
  try {
    await db
      .collection(COLLECTIONS.clientPortals)
      .doc(projectKey)
      .set({ users, updated_at: new Date().toISOString() }, { merge: true });
  } catch {
    return { error: "save_failed" };
  }
  await logAdminActivity({
    action: "update",
    entityType: "client_portal",
    entityId: projectKey,
    pagePath: "/client-portal-v2",
    context: { project: projectKey, users: users.length },
  });
  return {};
}

/** Persist only the dashboard sections, for the Visibility rules tab. */
export async function savePortalSections(input: {
  projectKey: string;
  sections: PortalConfig["sections"];
}): Promise<{ error?: "not_authorized" | "invalid" | "save_failed" }> {
  if (!(await allowed())) return { error: "not_authorized" };
  const projectKey = input.projectKey.trim().toLowerCase();
  if (!isPortalProjectKey(projectKey)) return { error: "invalid" };
  const db = await store();
  if (!db) return { error: "save_failed" };
  try {
    await db
      .collection(COLLECTIONS.clientPortals)
      .doc(projectKey)
      .set({ sections: input.sections, updated_at: new Date().toISOString() }, { merge: true });
  } catch {
    return { error: "save_failed" };
  }
  await logAdminActivity({
    action: "update",
    entityType: "client_portal",
    entityId: projectKey,
    pagePath: "/client-portal-v2",
    context: { project: projectKey, sections: input.sections },
  });
  return {};
}

