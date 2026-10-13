import type { Firestore } from "firebase-admin/firestore";
import {
  PERMISSIONS,
  type AuthProfile,
  canAccessAdminPanel,
} from "@/lib/auth/permissions";
import {
  parseStaffAccessKind,
  resolveSessionPermissionSlugs,
} from "@/lib/auth/staff-access";
import { COLLECTIONS, PERMISSION_CATALOG_DOC_ID } from "@/lib/firebase/db";
import type { PermissionArrayDoc, PermissionCatalogDoc, ProfileDoc } from "@/lib/firebase/types";

export type EnrichedProfile = ProfileDoc;

export function toAuthProfile(
  profile: EnrichedProfile,
  isSuperAdmin: boolean,
): AuthProfile {
  return {
    id: profile.id,
    role: profile.role,
    adminRoleId: profile.admin_role_id,
    approvalStatus: profile.approval_status,
    isSuperAdmin,
    archivedAt: profile.archived_at,
  };
}

/**
 * Per-isolate TTL cache for the permission catalog.
 *
 * The catalog changed on every admin edit of Roles & Permissions, and it was
 * re-read on every session load — a full-collection round trip per navigation
 * and per server action. Caching it removes one Firestore read from the
 * critical path of every page and every mutation while keeping Firestore as the
 * source of truth. A cold isolate still reads it once, and the 60 s TTL bounds
 * how long a warm one can be stale.
 */
const CATALOG_TTL_MS = 60_000;

let cachedCatalogSlugs: { value: string[]; expiresAt: number } | null = null;

/** Test seam. */
export function clearCatalogSlugsCache(): void {
  cachedCatalogSlugs = null;
}

async function loadCatalogSlugs(db: Firestore, now = Date.now()): Promise<string[]> {
  if (cachedCatalogSlugs && cachedCatalogSlugs.expiresAt > now) {
    return cachedCatalogSlugs.value;
  }

  const snap = await db
    .collection(COLLECTIONS.adminPermissions)
    .doc(PERMISSION_CATALOG_DOC_ID)
    .get();
  const stored = (snap.data() as PermissionCatalogDoc | undefined)?.slugs;
  const value = stored?.length ? stored : [...Object.values(PERMISSIONS)];

  cachedCatalogSlugs = { value, expiresAt: now + CATALOG_TTL_MS };
  return value;
}

async function loadRoleSlugs(db: Firestore, adminRoleId: string): Promise<string[]> {
  const snap = await db
    .collection(COLLECTIONS.adminRolePermissions)
    .doc(adminRoleId)
    .get();
  return (snap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
}

async function loadUserTicks(db: Firestore, userId: string): Promise<string[] | null> {
  try {
    const snap = await db.collection(COLLECTIONS.adminUserPermissions).doc(userId).get();
    if (!snap.exists) return [];
    return (snap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
  } catch {
    return null;
  }
}

export async function enrichSessionPermissions(
  db: Firestore,
  adminRoleId: string | null,
  isSuperAdmin: boolean,
  accessKindRaw?: string | null,
  userId?: string,
) {
  if (!adminRoleId) {
    return new Set<string>();
  }

  const accessKind = parseStaffAccessKind(accessKindRaw);

  // A super admin / Manager resolves from the catalog alone, so the catalog is
  // the only read on their path.
  if (isSuperAdmin || accessKind === "manager") {
    const catalogSlugs = await loadCatalogSlugs(db);
    return resolveSessionPermissionSlugs({
      isSuperAdmin,
      accessKind: accessKind ?? (isSuperAdmin ? "manager" : null),
      userTicks: [],
      roleSlugs: [],
      catalogSlugs,
    });
  }

  // The catalog and the caller's own ticks are independent reads, so they go
  // out together rather than queueing.
  const tickUserId = accessKind === "user" && userId ? userId : null;
  const [catalogSlugs, userTicks] = await Promise.all([
    loadCatalogSlugs(db),
    tickUserId ? loadUserTicks(db, tickUserId) : Promise.resolve(null),
  ]);

  if (userTicks) {
    return resolveSessionPermissionSlugs({
      isSuperAdmin,
      accessKind,
      userTicks,
      roleSlugs: [],
      catalogSlugs,
    });
  }

  const roleSlugs = await loadRoleSlugs(db, adminRoleId);
  return resolveSessionPermissionSlugs({
    isSuperAdmin,
    accessKind,
    userTicks: null,
    roleSlugs,
    catalogSlugs,
  });
}

export { canAccessAdminPanel };
