"use server";

import type { DocumentData, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  normalizeListColumnPreference,
  resolveUiPreference,
} from "@/lib/ui-preferences/merge";
import {
  type EffectiveUiPreference,
  type ListColumnPreference,
} from "@/lib/ui-preferences/types";

const USER_PREFS = "admin_ui_preferences";
const ROLE_DEFAULTS = "admin_role_ui_defaults";

async function requirePanelUser() {
  const session = await getSessionUser();
  if (!session) return null;
  return session;
}

async function requireSettingsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
    )
  ) {
    return null;
  }
  return session;
}

async function findPref(
  db: Firestore,
  collection: string,
  ownerField: string,
  ownerId: string,
  preferenceKey: string,
): Promise<QueryDocumentSnapshot | null> {
  const snap = await db.collection(collection).where(ownerField, "==", ownerId).get();
  return snap.docs.find((doc) => doc.data().preference_key === preferenceKey) ?? null;
}

function prefDocId(ownerId: string, preferenceKey: string): string {
  return `${ownerId}_${encodeURIComponent(preferenceKey)}`;
}

export async function getEffectiveUiPreference(
  preferenceKey: string,
  knownIds: string[],
  systemDefault: ListColumnPreference,
): Promise<EffectiveUiPreference<ListColumnPreference>> {
  const session = await requirePanelUser();
  if (!session) {
    return resolveUiPreference({
      system: systemDefault,
      role: null,
      user: null,
    });
  }

  const db = await staffDb();
  if (!db) {
    return resolveUiPreference({
      system: systemDefault,
      role: null,
      user: null,
    });
  }

  const roleId = session.profile.admin_role_id;
  const [userDoc, roleDoc] = await Promise.all([
    findPref(db, USER_PREFS, "user_id", session.id, preferenceKey),
    roleId
      ? findPref(db, ROLE_DEFAULTS, "role_id", roleId, preferenceKey)
      : Promise.resolve(null),
  ]);

  const roleValue = roleDoc?.data()?.value;
  const userValue = userDoc?.data()?.value;
  const roleNorm = roleValue
    ? normalizeListColumnPreference(roleValue, knownIds, systemDefault)
    : null;
  const userNorm = userValue
    ? normalizeListColumnPreference(userValue, knownIds, systemDefault)
    : null;

  return resolveUiPreference({
    system: systemDefault,
    role: roleNorm,
    user: userNorm,
  });
}

export async function saveUserUiPreference(
  preferenceKey: string,
  value: ListColumnPreference,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePanelUser();
  if (!session) return { error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  try {
    const existing = await findPref(db, USER_PREFS, "user_id", session.id, preferenceKey);
    const payload = {
      user_id: session.id,
      preference_key: preferenceKey,
      value,
      updated_at: new Date(),
    };
    if (existing) {
      await existing.ref.set(payload, { merge: true });
    } else {
      const id = prefDocId(session.id, preferenceKey);
      await db.collection(USER_PREFS).doc(id).set({ id, ...payload });
    }
  } catch {
    return { error: "save_failed" };
  }
  return { success: true };
}

export async function clearUserUiPreference(
  preferenceKey: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePanelUser();
  if (!session) return { error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  try {
    const existing = await findPref(db, USER_PREFS, "user_id", session.id, preferenceKey);
    if (existing) await existing.ref.delete();
  } catch {
    return { error: "save_failed" };
  }
  return { success: true };
}

function preferenceFromValue(value: unknown): ListColumnPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as DocumentData;
  if (!Array.isArray(record.order) || !Array.isArray(record.visible)) return null;
  const sort = record.sort;
  return {
    order: record.order.map(String),
    visible: record.visible.map(String),
    sort:
      sort && typeof sort === "object" && !Array.isArray(sort)
        ? {
            id: String((sort as { id?: unknown }).id ?? ""),
            dir: (sort as { dir?: string }).dir === "desc" ? "desc" : "asc",
          }
        : null,
  };
}

export async function getRoleUiDefault(
  roleId: string,
  preferenceKey: string,
): Promise<ListColumnPreference | null> {
  const session = await requireSettingsManage();
  if (!session) return null;

  const db = await staffDb();
  if (!db) return null;

  const existing = await findPref(db, ROLE_DEFAULTS, "role_id", roleId, preferenceKey);
  return preferenceFromValue(existing?.data()?.value);
}

export async function saveRoleUiDefault(
  roleId: string,
  preferenceKey: string,
  value: ListColumnPreference,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireSettingsManage();
  if (!session) return { error: "not_authorized" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  try {
    const existing = await findPref(db, ROLE_DEFAULTS, "role_id", roleId, preferenceKey);
    const payload = {
      role_id: roleId,
      preference_key: preferenceKey,
      value,
      updated_at: new Date(),
      updated_by: session.id,
    };
    if (existing) {
      await existing.ref.set(payload, { merge: true });
    } else {
      const id = prefDocId(roleId, preferenceKey);
      await db.collection(ROLE_DEFAULTS).doc(id).set({ id, ...payload });
    }
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "admin_role_ui_default",
    entityId: roleId,
    routeName: "saveRoleUiDefault",
    after: { preference_key: preferenceKey },
  });
  return { success: true };
}
