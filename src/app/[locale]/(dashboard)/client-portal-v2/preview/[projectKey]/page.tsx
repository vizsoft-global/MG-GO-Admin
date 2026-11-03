import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientDashboardV2 } from "@/features/portal-v2/client-dashboard-v2";
import { requirePermission } from "@/lib/auth/require-permission";
import { parsePartnerProjectKey } from "@/lib/auth/staff-access";

export default async function ClientPortalV2PreviewPage({
  params,
}: {
  params: Promise<{ locale: string; projectKey: string }>;
}) {
  const { locale, projectKey } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (!session.isSuperAdmin) {
    redirect({
      href: session.accessKind === "partner" ? "/client-portal-v2" : "/unauthorized",
      locale,
    });
  }
  const key = parsePartnerProjectKey(projectKey);
  switch (key) {
    case "keeta":
    case "americana":
    case "unassigned":
      return <ClientDashboardV2 preview={{ projectKey: key }} />;
    case null:
      redirect({ href: "/client-portal-v2/clients", locale });
      return null;
    default: {
      const neverKey: never = key;
      throw new Error(`unhandled project: ${String(neverKey)}`);
    }
  }
}
