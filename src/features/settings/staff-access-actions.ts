"use server";

import { updateTag } from "next/cache";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { getSessionUser } from "@/lib/auth/get-session";
import { CATALOG_SLUG_SET } from "@/lib/auth/permission-catalog";
import {
  expandRoleSlugsToUserTicks,
  isStaffMatrixSlug,
  parseStaffAccessKind,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import {
  APP_ACCESS_CATALOG,
  diffAccess,
  modulesSelectedCount,
  parseStaffDepartment,
  ticksToAppAccess,
  type StaffDepartment,
} from "@/lib/auth/app-access";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export type StaffLastChanged = {
  by: string | null;
  at: string | null;
};

export type RequestTypeGrant = {
  requestType: string;
  accessLevel: "view_only" | "approver";
};

export type RequestTypeOption = {
  key: string;
  labelEn: string;
  labelAr: string | null;
};

export type StaffAccessListRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  accessKind: StaffAccessKind | null;
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  isSuperAdmin: boolean;
  tickCount: number;
  modulesSelected: number;
  staffDepartment: StaffDepartment | null;
  slugs: string[];
  lastChanged: StaffLastChanged;
  updatedAt: string;
};

export type StaffAccessDetail = {
  id: string;
  fullName: string | null;
  email: string | null;
  accessKind: StaffAccessKind;
  roleId: string | null;
  roleName: string | null;
  isSuperAdmin: boolean;
  slugs: string[];
  staffDepartment: StaffDepartment | null;
  requestTypes: RequestTypeGrant[];
  lastChanged: StaffLastChanged;
};

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function slugsOf(data: DocumentData | undefined): string[] {
  const raw = data?.permission_slugs;
  return Array.isArray(raw) ? raw.filter((slug): slug is string => typeof slug === "string") : [];
}

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function matrixSlugs(slugs: string[]): string[] {
  return [...new Set(slugs.filter((slug) => CATALOG_SLUG_SET.has(slug) && isStaffMatrixSlug(slug)))];
}

async function lastChangedByEntities(
  db: Firestore,
  entityIds: string[],
): Promise<Map<string, StaffLastChanged>> {
  const map = new Map<string, StaffLastChanged>();
  if (entityIds.length === 0) return map;

  const wanted = new Set(entityIds);
  const logs: Array<{ entity_id: string; admin_user_id: string | null; created_at: string }> = [];
  const pushLog = (data: DocumentData) => {
    const entityId = typeof data.entity_id === "string" ? data.entity_id : "";
    if (!entityId || !wanted.has(entityId)) return;
    logs.push({
      entity_id: entityId,
      admin_user_id: typeof data.admin_user_id === "string" ? data.admin_user_id : null,
      created_at: iso(data.created_at) ?? "",
    });
  };

  try {
    for (let i = 0; i < entityIds.length; i += 30) {
      const part = entityIds.slice(i, i + 30);
      const snap = await db
        .collection(COLLECTIONS.adminActivityLogs)
        .where("entity_type", "==", "staff_access")
        .where("success", "==", true)
        .where("entity_id", "in", part)
        .orderBy("created_at", "desc")
        .limit(400)
        .get();
      for (const doc of snap.docs) pushLog(doc.data());
    }
  } catch {
    logs.length = 0;
    const snap = await db
      .collection(COLLECTIONS.adminActivityLogs)
      .where("entity_type", "==", "staff_access")
      .orderBy("created_at", "desc")
      .limit(400)
      .get();
    for (const doc of snap.docs) {
      if (doc.data().success !== true) continue;
      pushLog(doc.data());
    }
  }

  logs.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const actorIds = new Set<string>();
  for (const row of logs) {
    if (map.has(row.entity_id)) continue;
    map.set(row.entity_id, { by: null, at: row.created_at || null });
    if (row.admin_user_id) actorIds.add(row.admin_user_id);
  }

  if (actorIds.size === 0) return map;

  const actorRefs = [...actorIds].map((id) => db.collection(COLLECTIONS.profiles).doc(id));
  const actors = actorRefs.length > 0 ? await db.getAll(...actorRefs) : [];
  const names = new Map(
    actors.map((snap) => {
      const data = snap.data();
      const name =
        (typeof data?.full_name === "string" && data.full_name) ||
        (typeof data?.email === "string" && data.email) ||
        null;
      return [snap.id, name] as const;
    }),
  );

  for (const row of logs) {
    const current = map.get(row.entity_id);
    if (!current || current.by || current.at !== (row.created_at || null)) continue;
    map.set(row.entity_id, {
      at: row.created_at || null,
      by: row.admin_user_id ? (names.get(row.admin_user_id) ?? null) : null,
    });
  }

  return map;
}

export async function listStaffAccess(): Promise<{
  error?: string;
  rows?: StaffAccessListRow[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const snap = await db.collection(COLLECTIONS.profiles).where("role", "==", "staff").get();
  const people = snap.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as { id: string } & Record<string, unknown>,
  )
    .filter(
      (row) => row.approval_status === "approved" && (row.archived_at == null || row.archived_at === ""),
    )
    .sort((a, b) => {
      const aName = typeof a.full_name === "string" && a.full_name ? a.full_name : "\uffff";
      const bName = typeof b.full_name === "string" && b.full_name ? b.full_name : "\uffff";
      return aName.localeCompare(bName);
    });

  const ids = people.map((row) => row.id);
  const roleIds = [
    ...new Set(
      people
        .map((row) => (typeof row.admin_role_id === "string" ? row.admin_role_id : ""))
        .filter(Boolean),
    ),
  ];

  const [tickSnaps, roleSnaps] = await Promise.all([
    ids.length
      ? db.getAll(...ids.map((id) => db.collection(COLLECTIONS.adminUserPermissions).doc(id)))
      : Promise.resolve([]),
    roleIds.length
      ? db.getAll(...roleIds.map((id) => db.collection(COLLECTIONS.adminRoles).doc(id)))
      : Promise.resolve([]),
  ]);

  const slugsByUser = new Map<string, string[]>();
  for (const tick of tickSnaps) {
    const slugs = slugsOf(tick.data()).filter(isStaffMatrixSlug);
    slugsByUser.set(tick.id, slugs);
  }

  const roles = new Map(
    roleSnaps.map((role) => {
      const data = role.data() ?? {};
      return [
        role.id,
        {
          name: typeof data.name === "string" ? data.name : "",
          slug: typeof data.slug === "string" ? data.slug : "",
          is_super_admin: data.is_super_admin === true,
        },
      ] as const;
    }),
  );

  const lastChanged = await lastChangedByEntities(db, ids);

  return {
    rows: people.map((row) => {
      const roleId = typeof row.admin_role_id === "string" ? row.admin_role_id : null;
      const role = roleId ? roles.get(roleId) : undefined;
      const slugs = slugsByUser.get(row.id) ?? [];
      const fullAccess = role?.is_super_admin === true || parseStaffAccessKind(row.access_kind) === "manager";
      return {
        id: row.id,
        fullName: typeof row.full_name === "string" ? row.full_name : null,
        email: typeof row.email === "string" ? row.email : null,
        accessKind: parseStaffAccessKind(row.access_kind),
        roleId,
        roleName: role?.name ?? null,
        roleSlug: role?.slug ?? null,
        isSuperAdmin: role?.is_super_admin === true,
        tickCount: slugs.length,
        modulesSelected: fullAccess ? APP_ACCESS_CATALOG.length : modulesSelectedCount(slugs),
        staffDepartment: parseStaffDepartment(row.staff_department),
        slugs,
        lastChanged: lastChanged.get(row.id) ?? { by: null, at: null },
        updatedAt: iso(row.updated_at) ?? "",
      };
    }),
  };
}

export async function getStaffAccess(userId: string): Promise<{
  error?: string;
  detail?: StaffAccessDetail;
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const snap = await db.collection(COLLECTIONS.profiles).doc(userId).get();
  const data = snap.data();
  if (!snap.exists || !data || data.role !== "staff") return { error: "user_not_found" };

  const roleId = typeof data.admin_role_id === "string" ? data.admin_role_id : null;
  const [roleSnap, tickSnap, grantSnap, lastChanged] = await Promise.all([
    roleId ? db.collection(COLLECTIONS.adminRoles).doc(roleId).get() : Promise.resolve(null),
    db.collection(COLLECTIONS.adminUserPermissions).doc(userId).get(),
    db.collection(COLLECTIONS.requestStaffAccess).where("profile_id", "==", userId).get(),
    lastChangedByEntities(db, [userId]),
  ]);

  const role = roleSnap?.data();
  return {
    detail: {
      id: snap.id,
      fullName: typeof data.full_name === "string" ? data.full_name : null,
      email: typeof data.email === "string" ? data.email : null,
      accessKind: parseStaffAccessKind(data.access_kind) ?? "user",
      roleId,
      roleName: typeof role?.name === "string" ? role.name : null,
      isSuperAdmin: role?.is_super_admin === true,
      slugs: slugsOf(tickSnap.data()).filter(isStaffMatrixSlug),
      staffDepartment: parseStaffDepartment(data.staff_department),
      requestTypes: grantSnap.docs.map((doc) => {
        const grant = doc.data();
        return {
          requestType: String(grant.request_type ?? ""),
          accessLevel: grant.access_level === "approver" ? "approver" : "view_only",
        };
      }),
      lastChanged: lastChanged.get(userId) ?? { by: null, at: null },
    },
  };
}

export async function listRequestTypeOptions(): Promise<{
  error?: string;
  rows?: RequestTypeOption[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const snap = await db
    .collection(COLLECTIONS.requestTypeDefinitions)
    .where("is_active", "==", true)
    .get();

  const rows = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        key: typeof data.key === "string" ? data.key : doc.id,
        labelEn: typeof data.label_en === "string" ? data.label_en : "",
        labelAr: typeof data.label_ar === "string" ? data.label_ar : null,
        sort: typeof data.sort_order === "number" ? data.sort_order : 0,
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map(({ key, labelEn, labelAr }) => ({ key, labelEn, labelAr }));

  return { rows };
}

export async function saveStaffAccess(input: {
  userId: string;
  accessKind: StaffAccessKind;
  slugs: string[];
  department?: StaffDepartment | null;
  requestTypes?: RequestTypeGrant[];
}): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const kind = parseStaffAccessKind(input.accessKind);
  if (!kind) return { error: "invalid_kind" };
  if (input.department !== undefined && input.department !== null && !parseStaffDepartment(input.department)) {
    return { error: "invalid_department" };
  }

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(input.userId).get();
  const profile = profileSnap.data();
  if (!profileSnap.exists || !profile || profile.role !== "staff") return { error: "user_not_found" };

  const previousTicks = slugsOf(
    (await db.collection(COLLECTIONS.adminUserPermissions).doc(input.userId).get()).data(),
  );
  const slugs = kind === "user" ? matrixSlugs(input.slugs) : [];
  const beforeAccess = ticksToAppAccess(previousTicks.filter(isStaffMatrixSlug));
  const afterAccess = ticksToAppAccess(slugs);
  const accessDiff = diffAccess(beforeAccess, afterAccess);

  const profilePatch: {
    access_kind: StaffAccessKind;
    updated_at: Date;
    staff_department?: string | null;
  } = {
    access_kind: kind,
    updated_at: new Date(),
  };
  if (input.department !== undefined) {
    profilePatch.staff_department = input.department;
  }

  try {
    await profileSnap.ref.set(profilePatch, { merge: true });
    await db.collection(COLLECTIONS.adminUserPermissions).doc(input.userId).set(
      { permission_slugs: slugs },
      { merge: true },
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  if (input.requestTypes) {
    try {
      const existing = await db
        .collection(COLLECTIONS.requestStaffAccess)
        .where("profile_id", "==", input.userId)
        .get();
      const batch = db.batch();
      for (const doc of existing.docs) batch.delete(doc.ref);
      const rows = input.requestTypes.filter(
        (row) => row.accessLevel === "view_only" || row.accessLevel === "approver",
      );
      for (const row of rows) {
        const id = `${input.userId}_${row.requestType}`;
        batch.set(db.collection(COLLECTIONS.requestStaffAccess).doc(id), {
          id,
          profile_id: input.userId,
          request_type: row.requestType,
          access_level: row.accessLevel,
        });
      }
      await batch.commit();
    } catch (error) {
      return { error: error instanceof Error ? error.message : "save_failed" };
    }
  }

  try {
    await callAdminFunction("syncStaffClaims", { uid: input.userId });
  } catch {
    // Permission rows are already saved; claims refresh must not roll that back.
  }

  void logAdminActivity({
    action: "update",
    entityType: "staff_access",
    entityId: input.userId,
    pagePath: `/settings/roles?user=${input.userId}`,
    context: {
      access_kind: kind,
      tick_count: slugs.length,
      previous_kind: profile.access_kind,
      department: input.department ?? profile.staff_department,
      diff: {
        added: accessDiff.addedApps,
        removed: accessDiff.removedApps,
        levelChanges: accessDiff.levelChanges,
        changeCount: accessDiff.changeCount,
      },
    },
  });

  updateTag("admin-roles");
  return { success: true };
}

export async function copyRoleTemplateTicks(roleId: string): Promise<{
  error?: string;
  slugs?: string[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const snap = await db.collection(COLLECTIONS.adminRolePermissions).doc(roleId).get();
  return {
    slugs: [...expandRoleSlugsToUserTicks(slugsOf(snap.data()))].filter(isStaffMatrixSlug),
  };
}

export async function getUserTicksForCopy(sourceUserId: string): Promise<{
  error?: string;
  slugs?: string[];
  accessKind?: StaffAccessKind;
  requestTypes?: RequestTypeGrant[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const loaded = await getStaffAccess(sourceUserId);
  if (loaded.error || !loaded.detail) return { error: loaded.error ?? "user_not_found" };

  return {
    slugs: loaded.detail.slugs,
    accessKind: loaded.detail.accessKind,
    requestTypes: loaded.detail.requestTypes,
  };
}
