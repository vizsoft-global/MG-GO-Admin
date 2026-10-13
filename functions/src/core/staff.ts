import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "./fs";
import { COLLECTIONS, FIELDS } from "./collections";

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
  roleId: string | null;
  /** The caller's effective slugs, after the Manager/User resolution. */
  permissionSlugs: Set<string>;
};

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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "not_authorized");
  }

  const db = getFirestore();
  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(uid).get();
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
  const isManager = isSuperAdmin || accessKind === "manager";

  const permissions = await resolvePermissionSlugs(uid, roleId, isManager);

  if (requiredSlug && !permissionGranted(permissions, requiredSlug)) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  return { uid, isSuperAdmin, isManager, roleId, permissionSlugs: permissions };
}

/**
 * A Manager holds the whole catalog, so slugs come from the catalog doc; a User
 * holds only their own ticks. Both are one array doc, which is what keeps a
 * session load to a fixed number of reads instead of one per permission.
 */
async function resolvePermissionSlugs(
  uid: string,
  roleId: string | null,
  isManager: boolean,
): Promise<Set<string>> {
  const db = getFirestore();

  if (isManager) {
    const catalogSnap = await db
      .collection(COLLECTIONS.adminPermissions)
      .doc(ADMIN_PERMISSIONS_DOC_ID)
      .get();
    const stored = (catalogSnap.data() as { slugs?: string[] } | undefined)?.slugs ?? [];
    return new Set(stored);
  }

  const [roleSnap, userSnap] = await Promise.all([
    roleId
      ? db.collection(COLLECTIONS.adminRolePermissions).doc(roleId).get()
      : Promise.resolve(null),
    db.collection(COLLECTIONS.adminUserPermissions).doc(uid).get(),
  ]);

  const slugs = new Set<string>();
  const roleSlugs = (roleSnap?.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
  for (const slug of roleSlugs) slugs.add(slug);
  const userSlugs = (userSnap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
  for (const slug of userSlugs) slugs.add(slug);
  return grantDataCleanupIfBulkDelete(slugs);
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
