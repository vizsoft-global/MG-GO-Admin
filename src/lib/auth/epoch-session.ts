import {
  AUTH_EPOCHS_DOC_ID,
  epochCounters,
  readEpochAndDocs,
  sessionRevokedForMutation,
  sessionRevokedForRead,
  type EpochCache,
  type EpochCounters,
  type EpochReader,
} from "@/lib/auth/epoch-cache";
import {
  enrichSessionPermissions,
  toAuthProfile,
  type EnrichedProfile,
} from "@/lib/auth/profile-auth";
import { canAccessAdminPanel } from "@/lib/auth/permissions";
import { parseStaffAccessKind, type StaffAccessKind } from "@/lib/auth/staff-access";
import { COLLECTIONS } from "@/lib/firebase/db";
import type { ProfileDoc } from "@/lib/firebase/types";

export type EpochProbe = {
  uid: string | null;
  claims: { superAdmin?: boolean } | null;
  unavailable: boolean;
  authTimeMs: number | null;
};

export type EpochSession = {
  id: string;
  email: string | null;
  profile: EnrichedProfile;
  permissions: Set<string>;
  isSuperAdmin: boolean;
  isManager: boolean;
  accessKind: StaffAccessKind | null;
  adminRoleSlug: string;
  epochs: EpochCounters;
};

export type EpochSessionOutcome = {
  session: EpochSession | null;
  unavailable: boolean;
  revoked: boolean;
  denied: boolean;
  /** Rejected, archived, or no admin role. Distinct from a missing cookie. */
  notAuthorized: boolean;
};

function blockedProfile(profile: ProfileDoc): boolean {
  if (profile.archived_at) return true;
  if (profile.approval_status === "rejected") return true;
  if (profile.approval_status === "pending") return false;
  if (profile.role !== "staff") return true;
  if (!profile.admin_role_id) return true;
  return !canAccessAdminPanel(toAuthProfile(profile, false));
}

async function roleSlug(
  db: EpochReader,
  cache: EpochCache | null,
  roleId: string | null,
  seenEpoch: number,
  fresh: boolean,
): Promise<string | null> {
  if (!roleId) return null;
  if (fresh || !cache) {
    const snap = await db.collection(COLLECTIONS.adminRoles).doc(roleId).get();
    const slug = snap.data()?.slug;
    return typeof slug === "string" ? slug : null;
  }
  const filled = await readEpochAndDocs(db, cache, "access", seenEpoch, [
    { id: `role:${roleId}`, ref: db.collection(COLLECTIONS.adminRoles).doc(roleId) },
  ]);
  const slug = filled.values[0]?.data?.slug;
  return typeof slug === "string" ? slug : null;
}

async function assemble(
  db: EpochReader,
  cache: EpochCache | null,
  probe: EpochProbe,
  profile: ProfileDoc,
  epochs: EpochCounters,
  fresh: boolean,
  permission?: string,
): Promise<EpochSessionOutcome> {
  const isSuperAdmin = probe.claims?.superAdmin === true;
  const accessKind = parseStaffAccessKind(profile.access_kind);
  const isManager = isSuperAdmin || accessKind === "manager";
  const [permissions, slug] = await Promise.all([
    enrichSessionPermissions(db, profile.admin_role_id, isSuperAdmin, accessKind, probe.uid ?? undefined, {
      cache: fresh ? undefined : (cache ?? undefined),
      seenEpoch: epochs.access,
      fresh,
    }),
    roleSlug(db, cache, profile.admin_role_id, epochs.access, fresh),
  ]);
  const session: EpochSession = {
    id: probe.uid ?? "",
    email: profile.email,
    profile,
    permissions,
    isSuperAdmin,
    isManager,
    accessKind,
    adminRoleSlug: slug ?? "operator",
    epochs,
  };
  const denied = permission
    ? !isSuperAdmin && !permissions.has(permission)
    : false;
  return { session, unavailable: false, revoked: false, denied, notAuthorized: false };
}

/**
 * Epoch and profile are one getAll. The profile is not cached. Permission and
 * role fills use the epoch from this read, and re-read it with their data on a miss.
 */
export async function loadReadSession(
  db: EpochReader,
  cache: EpochCache,
  probe: EpochProbe,
): Promise<EpochSessionOutcome> {
  if (!probe.uid) {
    return { session: null, unavailable: probe.unavailable, revoked: false, denied: false, notAuthorized: false };
  }
  const [epochSnap, profileSnap] = await db.getAll(
    db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID),
    db.collection(COLLECTIONS.profiles).doc(probe.uid),
  );
  if (!profileSnap?.exists) {
    return { session: null, unavailable: false, revoked: false, denied: false, notAuthorized: true };
  }
  const profile = { id: probe.uid, ...(profileSnap.data() ?? {}) } as ProfileDoc;
  const epochs = epochCounters(epochSnap?.exists ? epochSnap.data() : undefined);
  if (sessionRevokedForRead(probe.authTimeMs, profile.sessions_revoked_at)) {
    return { session: null, unavailable: false, revoked: true, denied: false, notAuthorized: false };
  }
  if (blockedProfile(profile)) {
    return { session: null, unavailable: false, revoked: false, denied: false, notAuthorized: true };
  }
  return assemble(db, cache, probe, profile, epochs, false);
}

/** Fresh profile and ticks. No epoch cache. Revocation ignores the read skew. */
export async function loadMutationSession(
  db: EpochReader,
  probe: EpochProbe,
  permission?: string,
): Promise<EpochSessionOutcome> {
  if (!probe.uid) {
    return { session: null, unavailable: probe.unavailable, revoked: false, denied: false, notAuthorized: false };
  }
  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(probe.uid).get();
  if (!profileSnap.exists) {
    return { session: null, unavailable: false, revoked: false, denied: false, notAuthorized: true };
  }
  const profile = { id: probe.uid, ...(profileSnap.data() ?? {}) } as ProfileDoc;
  if (sessionRevokedForMutation(probe.authTimeMs, profile.sessions_revoked_at)) {
    return { session: null, unavailable: false, revoked: true, denied: false, notAuthorized: false };
  }
  if (blockedProfile(profile)) {
    return { session: null, unavailable: false, revoked: false, denied: false, notAuthorized: true };
  }
  const epochSnap = await db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID).get();
  const epochs = epochCounters(epochSnap.exists ? epochSnap.data() : undefined);
  return assemble(db, null, probe, profile, epochs, true, permission);
}
