import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { activeCallableName } from "./callable-name";
import { getFirestore } from "./fs";
import { COLLECTIONS, FIELDS } from "./collections";
import { AUTH_EPOCHS_DOC_ID, configEpochs, createKeyedEpochCache } from "./config-cache";

/** Same list as `src/lib/auth/staff-access.ts` — a `.manage` module alias. */
const RESOURCE_CRUD_MODULES = new Set<string>([
  "drivers",
  "driver_groups",
  "partners",
  "restaurants",
  "vehicles",
  "assets",
  "deliveries",
  "verifications",
  "zones",
  "attendance",
  "requests",
  "wrong_actions",
  "documents",
  "earnings",
  "notifications",
  "support",
  "payroll",
  "fuel",
  "companies",
  "order_recon",
]);

export type StaffContext = {
  uid: string;
  isSuperAdmin: boolean;
  isManager: boolean;
  isPartner: boolean;
  partnerProjectKey: string | null;
  accessKind: string | null;
  roleId: string | null;
  /** The caller's effective slugs, after the Manager/User resolution. */
  permissionSlugs: Set<string>;
};

/** Callables a partner session may invoke. Compared case-insensitively to FUNCTION_TARGET / K_SERVICE. */
export const PARTNER_CALLABLE_ALLOWLIST = [
  "adminListDriversPage",
  "adminDriversFilterValues",
  "adminEmployeesDashboard",
  "adminListLeavePlans",
  "adminClientPortalDashboard",
] as const;

const PARTNER_CALLABLE_ALLOWLIST_SET = new Set(
  PARTNER_CALLABLE_ALLOWLIST.map((name) => name.toLowerCase()),
);

const PARTNER_SEED_SLUGS = ["client_portal.view", "drivers.view"];

export function partnerCallableAllowed(functionName: string | undefined): boolean {
  if (!functionName) return false;
  const bare = functionName.split("/").pop()?.trim().toLowerCase() ?? "";
  return PARTNER_CALLABLE_ALLOWLIST_SET.has(bare);
}

export function scopedProjectKey(staff: StaffContext, requested: unknown): string | null {
  if (!staff.isPartner) {
    return typeof requested === "string" && requested.trim() ? requested.trim().toLowerCase() : null;
  }
  return staff.partnerProjectKey;
}

type PermissionArrayDoc = { permission_slugs?: string[] };

const ADMIN_PERMISSIONS_DOC_ID = "permissions";

/**
 * The Firestore form of `is_admin_panel_user()`.
 *
 * `staff` rides the custom claims, because the claim is set only by
 * `syncStaffClaims` from the profile, so reading Firestore for it would be a
 * second and weaker source for the same fact. The profile is still read, because
 * the claim says *what kind* of user this is while the profile says whether the
 * account is still approved and not archived — a revoked admin keeps a valid
 * token until it expires, and the claim cannot know that.
 */
export async function requireStaff(
  request: CallableRequest<unknown>,
  requiredSlug?: string,
): Promise<StaffContext> {
  return resolveStaff(request, requiredSlug, false);
}

/**
 * Same as `requireStaff`, with the permission documents re-read from Firestore.
 *
 * Use this from a callable that changes money, permissions, or account state.
 * The cached path is delayed by at most one `access` counter bump, which is
 * fine for a read and not fine for a write that a revoked tick must not make.
 */
export async function requireStaffFresh(
  request: CallableRequest<unknown>,
  requiredSlug?: string,
): Promise<StaffContext> {
  return resolveStaff(request, requiredSlug, true);
}

/**
 * Fresh profile, epoch-keyed permission documents.
 *
 * The profile stays a per-call read: approval, archive, and `admin_role_id`
 * have to be current, and a callable token carries no `auth_time` comparable
 * with `sessions_revoked_at`. (Callable tokens are minted per request, so
 * `request.auth.token.auth_time` is not the session cookie's `auth_time` and
 * must never be compared with it.)
 *
 * The permission documents are different. Their key is the `access` counter of
 * `auth_epochs/current`, which every role, tick, and catalog writer already
 * bumps, and the counter is read in the *same* `getAll` as the profile. A
 * permission change therefore lands on the next call after the counter moves,
 * and the TTL is only a safety net for console edits. This is what removes the
 * extra read from the critical path of all ~250 staff callables.
 */
async function resolveStaff(
  request: CallableRequest<unknown>,
  requiredSlug: string | undefined,
  fresh: boolean,
): Promise<StaffContext> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "not_authorized");
  }

  const db = getFirestore();
  const [profileSnap, epochSnap] = await db.getAll(
    db.collection(COLLECTIONS.profiles).doc(uid),
    db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID),
  );
  if (!profileSnap.exists) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  const profile = profileSnap.data() ?? {};
  if (profile[FIELDS.profiles.role] !== "staff") {
    throw new HttpsError("permission-denied", "not_authorized");
  }
  if (profile[FIELDS.profiles.approvalStatus] !== "approved") {
    throw new HttpsError("permission-denied", "not_authorized");
  }
  if (profile[FIELDS.profiles.archivedAt]) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  const isSuperAdmin = request.auth?.token.superAdmin === true;
  const roleId = (profile[FIELDS.profiles.adminRoleId] as string | null) ?? null;
  const accessKind = (profile.access_kind as string | null) ?? null;
  const isPartner = accessKind === "partner";
  const isManager = !isPartner && (isSuperAdmin || accessKind === "manager");
  const partnerProjectKey = isPartner ? partnerProjectOf(profile.partner_project_key) : null;
  if (isPartner && !partnerProjectKey) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  // A missing counters document means "no invalidation signal", so the cache is
  // skipped rather than pinned to a zero that would never move.
  const epoch = !fresh && epochSnap.exists ? configEpochs(epochSnap.data()).access : null;
  const permissions = await resolvePermissionSlugs(uid, roleId, isManager, isPartner, epoch);

  if (isPartner && !partnerCallableAllowed(activeCallableName())) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  if (requiredSlug && !isSuperAdmin && !permissionGranted(permissions, requiredSlug)) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  return {
    uid,
    isSuperAdmin,
    isManager,
    isPartner,
    partnerProjectKey,
    accessKind,
    roleId,
    permissionSlugs: permissions,
  };
}

function partnerProjectOf(value: unknown): "keeta" | "americana" | null {
  if (value === "keeta" || value === "americana") return value;
  return null;
}

/** Staff with any of the slugs (super admin still bypasses). */
export async function requireStaffAny(
  request: CallableRequest<unknown>,
  slugs: readonly string[],
): Promise<StaffContext> {
  const staff = await requireStaff(request);
  if (staff.isSuperAdmin) return staff;
  if (slugs.some((slug) => permissionGranted(staff.permissionSlugs, slug))) {
    return staff;
  }
  throw new HttpsError("permission-denied", "not_authorized");
}

type PermissionDoc = { slugs: string[] };

/**
 * One entry per role id, per user id, and one for the manager catalog. Bounded
 * so a large staff roster cannot grow the isolate heap without limit.
 */
const permissionCache = createKeyedEpochCache<PermissionDoc>({ maxKeys: 2_000 });

/** Test seam. Drops every cached permission document for this isolate. */
export function clearPermissionCache(): void {
  permissionCache.clear();
}

function slugArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((slug): slug is string => typeof slug === "string")
    : [];
}

async function catalogSlugs(epoch: number | null): Promise<string[]> {
  const load = async (): Promise<PermissionDoc> => {
    const snap = await getFirestore()
      .collection(COLLECTIONS.adminPermissions)
      .doc(ADMIN_PERMISSIONS_DOC_ID)
      .get();
    const data = snap.data() as { slugs?: unknown } | undefined;
    return { slugs: slugArray(data?.slugs) };
  };
  if (epoch === null) return (await load()).slugs;
  return (await permissionCache.get("catalog", epoch, load)).slugs;
}

async function roleSlugs(roleId: string, epoch: number | null): Promise<string[]> {
  const load = async (): Promise<PermissionDoc> => {
    const snap = await getFirestore()
      .collection(COLLECTIONS.adminRolePermissions)
      .doc(roleId)
      .get();
    return { slugs: slugArray((snap.data() as PermissionArrayDoc | undefined)?.permission_slugs) };
  };
  if (epoch === null) return (await load()).slugs;
  return (await permissionCache.get(`role:${roleId}`, epoch, load)).slugs;
}

async function userSlugs(uid: string, epoch: number | null): Promise<string[]> {
  const load = async (): Promise<PermissionDoc> => {
    const snap = await getFirestore()
      .collection(COLLECTIONS.adminUserPermissions)
      .doc(uid)
      .get();
    if (!snap.exists) return { slugs: [] };
    return { slugs: slugArray((snap.data() as PermissionArrayDoc | undefined)?.permission_slugs) };
  };
  if (epoch === null) return (await load()).slugs;
  return (await permissionCache.get(`user:${uid}`, epoch, load)).slugs;
}

/**
 * A Manager holds the whole catalog, so slugs come from the catalog doc; a User
 * holds the union of their role's slugs and their own ticks. Both are one array
 * doc, which is what keeps a session load to a fixed number of reads instead of
 * one per permission.
 */
async function resolvePermissionSlugs(
  uid: string,
  roleId: string | null,
  isManager: boolean,
  isPartner: boolean,
  epoch: number | null,
): Promise<Set<string>> {
  if (isPartner) return new Set(PARTNER_SEED_SLUGS);
  if (isManager) {
    return new Set(await catalogSlugs(epoch));
  }

  const [role, user] = await Promise.all([
    roleId ? roleSlugs(roleId, epoch) : Promise.resolve<string[]>([]),
    userSlugs(uid, epoch),
  ]);
  return grantDataCleanupIfBulkDelete(mergePermissionSlugs(role, user));
}

/** A role's slugs plus the caller's own ticks. Exported for the unit test. */
export function mergePermissionSlugs(
  roleSlugsAndTicks: readonly string[],
  userTicks: readonly string[],
): Set<string> {
  const slugs = new Set<string>();
  for (const slug of roleSlugsAndTicks) slugs.add(slug);
  for (const slug of userTicks) slugs.add(slug);
  return slugs;
}

/**
 * Mirrors `permissionGrantedByTicks`: a `.manage` holder satisfies
 * create/edit/delete and a CRUD tick satisfies `.manage`, so a role saved under
 * either spelling keeps working. `.bulk_delete` is deliberately never
 * satisfiable by another tick — clearing a module is not the same decision as
 * editing a row.
 */
function permissionGranted(ticks: ReadonlySet<string>, permission: string): boolean {
  if (ticks.has(permission)) return true;
  const dot = permission.lastIndexOf(".");
  if (dot <= 0) return false;
  const module = permission.slice(0, dot);
  if (!RESOURCE_CRUD_MODULES.has(module)) return false;
  const verb = permission.slice(dot + 1);
  if (verb === "manage") {
    return (
      ticks.has(`${module}.create`) ||
      ticks.has(`${module}.edit`) ||
      ticks.has(`${module}.delete`)
    );
  }
  if (verb === "bulk_delete") return false;
  if (verb === "create" || verb === "edit" || verb === "delete") {
    return ticks.has(`${module}.manage`);
  }
  return false;
}

function grantDataCleanupIfBulkDelete(slugs: Set<string>): Set<string> {
  for (const slug of slugs) {
    if (slug.endsWith(".bulk_delete")) {
      slugs.add("data.cleanup");
      break;
    }
  }
  return slugs;
}
