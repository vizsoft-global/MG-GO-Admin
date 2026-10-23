import {
  readEpochAndDocs,
  type DocRef,
  type EpochCache,
  type EpochReader,
} from "@/lib/auth/epoch-cache";
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

export type PermissionReadOptions = {
  cache?: EpochCache;
  seenEpoch?: number;
  fresh?: boolean;
};

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

function slugsFrom(data: Record<string, unknown> | undefined): string[] | null {
  const stored = data?.slugs;
  if (!Array.isArray(stored) || stored.length === 0) return null;
  return stored.filter((slug): slug is string => typeof slug === "string");
}

async function loadCatalogSlugs(db: EpochReader, now = Date.now()): Promise<string[]> {
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

async function loadRoleSlugs(db: EpochReader, adminRoleId: string): Promise<string[]> {
  const snap = await db
    .collection(COLLECTIONS.adminRolePermissions)
    .doc(adminRoleId)
    .get();
  return (snap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
}

async function loadUserTicks(db: EpochReader, userId: string): Promise<string[] | null> {
  try {
    const snap = await db.collection(COLLECTIONS.adminUserPermissions).doc(userId).get();
    if (!snap.exists) return [];
    return (snap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
  } catch {
    return null;
  }
}

async function readCatalogNow(db: EpochReader): Promise<string[]> {
  const snap = await db
    .collection(COLLECTIONS.adminPermissions)
    .doc(PERMISSION_CATALOG_DOC_ID)
    .get();
  return slugsFrom(snap.data()) ?? [...Object.values(PERMISSIONS)];
}

async function catalogFromEpoch(
  db: EpochReader,
  cache: EpochCache,
  seenEpoch: number,
  extra: ReadonlyArray<{ id: string; ref: DocRef }> = [],
): Promise<{ catalogSlugs: string[]; extra: Array<{ exists: boolean; data: Record<string, unknown> | undefined }> }> {
  const catalogRef = db.collection(COLLECTIONS.adminPermissions).doc(PERMISSION_CATALOG_DOC_ID);
  const docs = [{ id: "catalog", ref: catalogRef }, ...extra];
  const filled = await readEpochAndDocs(db, cache, "access", seenEpoch, docs);
  const catalogSlugs =
    slugsFrom(filled.values[0]?.data) ?? [...Object.values(PERMISSIONS)];
  return { catalogSlugs, extra: filled.values.slice(1) };
}

export async function enrichSessionPermissions(
  db: EpochReader,
  adminRoleId: string | null,
  isSuperAdmin: boolean,
  accessKindRaw?: string | null,
  userId?: string,
  options?: PermissionReadOptions,
) {
  if (!adminRoleId) {
    return new Set<string>();
  }

  const accessKind = parseStaffAccessKind(accessKindRaw);
  if (accessKind === "partner") {
    return resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind,
      userTicks: [],
      roleSlugs: [],
      catalogSlugs: [],
    });
  }
  const epochCache = options?.fresh ? undefined : options?.cache;
  const seenEpoch = options?.seenEpoch ?? 0;

  // A super admin / Manager resolves from the catalog alone, so the catalog is
  // the only read on their path.
  if (isSuperAdmin || accessKind === "manager") {
    const catalogSlugs = epochCache
      ? (await catalogFromEpoch(db, epochCache, seenEpoch)).catalogSlugs
      : options?.fresh
        ? await readCatalogNow(db)
        : await loadCatalogSlugs(db);
    return resolveSessionPermissionSlugs({
      isSuperAdmin,
      accessKind: accessKind ?? (isSuperAdmin ? "manager" : null),
      userTicks: [],
      roleSlugs: [],
      catalogSlugs,
    });
  }

  // The catalog and the caller's own ticks are one getAll with the epoch when
  // the epoch cache is in use. The TTL path keeps them parallel.
  const tickUserId = accessKind === "user" && userId ? userId : null;
  let catalogSlugs: string[];
  let userTicks: string[] | null;
  if (epochCache && tickUserId) {
    try {
      const filled = await catalogFromEpoch(db, epochCache, seenEpoch, [
        {
          id: `ticks:${tickUserId}`,
          ref: db.collection(COLLECTIONS.adminUserPermissions).doc(tickUserId),
        },
      ]);
      catalogSlugs = filled.catalogSlugs;
      const tickDoc = filled.extra[0];
      const raw = tickDoc?.data?.permission_slugs;
      userTicks =
        tickDoc?.exists && Array.isArray(raw)
          ? raw.filter((slug): slug is string => typeof slug === "string")
          : [];
    } catch {
      catalogSlugs = await readCatalogNow(db);
      userTicks = null;
    }
  } else if (epochCache) {
    catalogSlugs = (await catalogFromEpoch(db, epochCache, seenEpoch)).catalogSlugs;
    userTicks = null;
  } else {
    const loaded = await Promise.all([
      options?.fresh ? readCatalogNow(db) : loadCatalogSlugs(db),
      tickUserId ? loadUserTicks(db, tickUserId) : Promise.resolve(null),
    ]);
    catalogSlugs = loaded[0];
    userTicks = loaded[1];
  }

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
