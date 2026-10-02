import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/types/database";
import {
  PERMISSIONS,
  type AdminApprovalStatus,
  type AuthProfile,
  canAccessAdminPanel,
} from "@/lib/auth/permissions";
import {
  parseStaffAccessKind,
  resolveSessionPermissionSlugs,
} from "@/lib/auth/staff-access";

export type EnrichedProfile = Profile & {
  admin_role_id: string | null;
  approval_status: AdminApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
};

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
 * `admin_permissions` was re-read on every single session load — a full-table
 * round trip per navigation and per server action, for a list that only changes
 * when an admin opens Roles & Permissions. Caching it removes one Supabase hop
 * from the critical path of every page and every mutation while keeping the
 * database as the source of truth, the same trade the proxy already makes for
 * `app_settings`.
 *
 * A cold isolate still reads it once, so a newly seeded slug is picked up on
 * the next instance, and the 60 s TTL bounds how long a warm one can be stale.
 */
const CATALOG_TTL_MS = 60_000;

let cachedCatalogSlugs: { value: string[]; expiresAt: number } | null = null;

/** Test seam. */
export function clearCatalogSlugsCache(): void {
  cachedCatalogSlugs = null;
}

async function loadCatalogSlugs(
  supabase: SupabaseClient<Database>,
  now = Date.now(),
): Promise<string[]> {
  if (cachedCatalogSlugs && cachedCatalogSlugs.expiresAt > now) {
    return cachedCatalogSlugs.value;
  }

  const { data } = await supabase.from("admin_permissions").select("slug");
  const value = data?.length
    ? data.map((row) => row.slug)
    : [...Object.values(PERMISSIONS)];

  cachedCatalogSlugs = { value, expiresAt: now + CATALOG_TTL_MS };
  return value;
}

async function loadRoleSlugs(
  supabase: SupabaseClient<Database>,
  adminRoleId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", adminRoleId);
  return data?.map((row) => row.permission_slug) ?? [];
}

async function loadUserTicks(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("admin_user_permissions")
    .select("permission_slug")
    .eq("user_id", userId);
  if (error) return null;
  return data?.map((row) => row.permission_slug) ?? [];
}

export async function enrichSessionPermissions(
  supabase: SupabaseClient<Database>,
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
    const catalogSlugs = await loadCatalogSlugs(supabase);
    return resolveSessionPermissionSlugs({
      isSuperAdmin,
      accessKind: accessKind ?? (isSuperAdmin ? "manager" : null),
      userTicks: [],
      roleSlugs: [],
      catalogSlugs,
    });
  }

  // The catalog and the caller's own ticks are independent reads, so they go
  // out together. They used to be sequential — catalog first, then ticks —
  // which put two Supabase round trips back to back on the critical path of
  // every page and every mutation. On a cold isolate the two now overlap
  // instead of queueing; on a warm one the catalog is already cached and this
  // is a single round trip either way.
  const tickUserId = accessKind === "user" && userId ? userId : null;
  const [catalogSlugs, userTicks] = await Promise.all([
    loadCatalogSlugs(supabase),
    tickUserId ? loadUserTicks(supabase, tickUserId) : Promise.resolve(null),
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

  const roleSlugs = await loadRoleSlugs(supabase, adminRoleId);
  return resolveSessionPermissionSlugs({
    isSuperAdmin,
    accessKind,
    userTicks: null,
    roleSlugs,
    catalogSlugs,
  });
}

export { canAccessAdminPanel };
