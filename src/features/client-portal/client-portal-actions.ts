"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { callAdminFunction } from "@/lib/firebase/callable";
import { resolvePortalProject } from "./portal-access";
import { emptyClientPortal, normalizeClientPortal, type ClientPortalDashboard } from "./shape";

export async function fetchClientPortalDashboard(input: {
  day?: string;
  zoneId?: string;
  projectKey?: string;
}): Promise<{ dashboard: ClientPortalDashboard; failed: boolean }> {
  const session = await getSessionUser();
  if (
    !session ||
    (!session.isSuperAdmin && !session.permissions.has("client_portal.view"))
  ) {
    return { dashboard: emptyClientPortal(), failed: true };
  }
  const resolved = resolvePortalProject(session, input.projectKey);
  if ("error" in resolved) return { dashboard: emptyClientPortal(), failed: true };
  const args: Record<string, unknown> = { projectKey: resolved.projectKey };
  if (input.day) args.day = input.day;
  if (input.zoneId) args.zoneId = input.zoneId;
  const { data, error } = await callAdminFunction<unknown>("adminClientPortalDashboard", args);
  if (error || data == null) return { dashboard: emptyClientPortal(), failed: true };
  return { dashboard: normalizeClientPortal(data), failed: false };
}
