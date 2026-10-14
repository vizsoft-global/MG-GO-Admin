"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { IncomingTypeGrant } from "./esign-staff-access";
import type { EsignCategoryGrant } from "./esign-staff-access";

export type MyDeskGrants = {
  requestTypes: IncomingTypeGrant[];
  esignCategories: EsignCategoryGrant[];
  hasOutgoingManage: boolean;
  hasIncomingView: boolean;
  isSuperAdmin: boolean;
};

export async function fetchMyDeskGrants(): Promise<MyDeskGrants & { error?: string }> {
  const session = await getSessionUser();
  if (!session) {
    return {
      requestTypes: [],
      esignCategories: [],
      hasOutgoingManage: false,
      hasIncomingView: false,
      isSuperAdmin: false,
      error: "not_authorized",
    };
  }
  const db = await staffDb();
  if (!db) {
    return {
      requestTypes: [],
      esignCategories: [],
      hasOutgoingManage: false,
      hasIncomingView: false,
      isSuperAdmin: session.isSuperAdmin,
      error: "not_configured",
    };
  }

  const [requestSnap, esignSnap] = await Promise.all([
    db.collection(COLLECTIONS.requestStaffAccess).where("profile_id", "==", session.id).get(),
    db.collection(COLLECTIONS.esignStaffAccess).where("profile_id", "==", session.id).get(),
  ]);

  return {
    requestTypes: requestSnap.docs.map((doc) => {
      const grant = doc.data();
      return {
        requestType: String(grant.request_type ?? ""),
        accessLevel: grant.access_level === "approver" ? "approver" : "view_only",
      };
    }),
    esignCategories: esignSnap.docs.map((doc) => {
      const grant = doc.data();
      return {
        categoryKey: String(grant.category_key ?? ""),
        parentKey: typeof grant.parent_key === "string" ? grant.parent_key : null,
        accessLevel: "sender" as const,
      };
    }),
    hasOutgoingManage: hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin),
    hasIncomingView:
      hasPermissionInSet(session.permissions, "requests.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "requests.approve", session.isSuperAdmin),
    isSuperAdmin: session.isSuperAdmin,
  };
}
