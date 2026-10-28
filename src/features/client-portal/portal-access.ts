import { parsePartnerProjectKey } from "@/lib/auth/staff-access";

export type PortalAccessSession = {
  accessKind: string | null;
  isSuperAdmin: boolean;
  partnerProjectKey: string | null;
};

export function resolvePortalProject(
  session: PortalAccessSession,
  requested: string | undefined,
): { projectKey: string } | { error: "denied" } {
  if (session.accessKind === "partner") {
    const key = parsePartnerProjectKey(session.partnerProjectKey);
    if (!key) return { error: "denied" };
    return { projectKey: key };
  }
  if (session.isSuperAdmin) {
    return { projectKey: parsePartnerProjectKey(requested) ?? "keeta" };
  }
  return { error: "denied" };
}
