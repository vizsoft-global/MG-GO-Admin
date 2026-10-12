import "../core/init";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "../core/fs";

export type StaffClaims = {
  staff: boolean;
  superAdmin: boolean;
  roleId: string | null;
};

/**
 * Derives the staff claims for a uid from its Firestore profile.
 *
 * Claims are always derived from the stored profile, never from the caller's
 * payload — a staff member re-syncing their own claims cannot grant themselves
 * `superAdmin`, because there is no field in the request that reaches the
 * computed value.
 */
async function resolveStaffClaims(uid: string): Promise<StaffClaims | null> {
  const db = getFirestore();
  const profileSnap = await db.collection("profiles").doc(uid).get();
  if (!profileSnap.exists) return null;

  const profile = profileSnap.data() ?? {};
  if (profile.role !== "staff") return null;

  const roleId = (profile.admin_role_id as string | null) ?? null;
  let isSuperAdmin = false;
  if (roleId) {
    const roleSnap = await db.collection("admin_roles").doc(roleId).get();
    isSuperAdmin = roleSnap.data()?.is_super_admin === true;
  }

  return { staff: true, superAdmin: isSuperAdmin, roleId };
}

/**
 * Staff custom claims, set only here.
 *
 * `uid` may be omitted (the caller syncs their own claims). Naming another uid
 * requires the caller to already be a super admin, so this doubles as the
 * role-change hook without opening a way to promote arbitrary accounts.
 */
export const syncStaffClaims = onCall(async (request: CallableRequest<{ uid?: string }>) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "not_authenticated");
  }

  const targetUid = request.data?.uid?.trim() || callerUid;

  if (targetUid !== callerUid) {
    const callerProfile = await getFirestore().collection("profiles").doc(callerUid).get();
    const callerRoleId = callerProfile.data()?.admin_role_id as string | undefined;
    const callerIsSuperAdmin = callerRoleId
      ? (await getFirestore().collection("admin_roles").doc(callerRoleId).get()).data()
          ?.is_super_admin === true
      : false;
    if (!callerIsSuperAdmin) {
      throw new HttpsError("permission-denied", "not_authorized");
    }
  }

  const claims = await resolveStaffClaims(targetUid);
  if (!claims) {
    throw new HttpsError("permission-denied", "not_staff");
  }

  await getAuth().setCustomUserClaims(targetUid, claims);
  return { uid: targetUid, claims };
});
