/**
 * Where a signed-in visitor on /login or /signup should go.
 * Absent when the form itself is the right page (rejected, archived, no role).
 */
export function signedInEntryRedirect(profile: {
  approval_status?: string | null;
  admin_role_id?: string | null;
} | null | undefined): "/pending-approval" | "/dashboard" | null {
  if (!profile) return null;
  if (profile.approval_status === "pending") return "/pending-approval";
  if (profile.approval_status === "approved" && profile.admin_role_id) return "/dashboard";
  return null;
}

export type PanelGate =
  | "unavailable"
  | "login"
  | "not_authorized"
  | "claim"
  | "pending"
  | "maintenance"
  | "ok";

/**
 * One decision for the panel gate. Unclaimed super-admin wins over pending so
 * the claim page cannot be skipped. Maintenance stays behind an approved session.
 */
export function panelGate(input: {
  hasSession: boolean;
  unavailable: boolean;
  notAuthorized: boolean;
  approvalStatus?: string | null;
  adminRoleId?: string | null;
  archivedAt?: string | null;
  isSuperAdmin: boolean;
  unclaimedSuperAdmin: boolean;
  maintenanceMode: boolean;
}): PanelGate {
  if (!input.hasSession && input.unavailable) return "unavailable";
  if (!input.hasSession && input.notAuthorized) return "not_authorized";
  if (!input.hasSession) return "login";
  if (input.unclaimedSuperAdmin) return "claim";
  if (input.approvalStatus === "pending") return "pending";
  if (input.approvalStatus === "rejected" || input.archivedAt || !input.adminRoleId) {
    return "not_authorized";
  }
  if (input.maintenanceMode && !input.isSuperAdmin) return "maintenance";
  return "ok";
}
