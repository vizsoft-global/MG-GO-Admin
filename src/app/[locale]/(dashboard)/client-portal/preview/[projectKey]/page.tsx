import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientPortalShell } from "@/features/client-portal/client-portal-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { parsePartnerProjectKey } from "@/lib/auth/staff-access";

export default async function ClientPortalPreviewPage({
  params,
}: {
  params: Promise<{ locale: string; projectKey: string }>;
}) {
  const { locale, projectKey } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (!session.isSuperAdmin) {
    redirect({
      href: session.accessKind === "partner" ? "/client-portal" : "/unauthorized",
      locale,
    });
  }
  const key = parsePartnerProjectKey(projectKey);
  switch (key) {
    case "keeta":
    case "americana":
    case "unassigned":
      return <ClientPortalShell preview={{ projectKey: key }} />;
    case null:
      redirect({ href: "/client-portal/clients", locale });
      return null;
    default: {
      const neverKey: never = key;
      throw new Error(`unhandled project: ${String(neverKey)}`);
    }
  }
}
