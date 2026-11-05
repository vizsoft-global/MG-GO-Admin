import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientDashboardV2 } from "@/features/portal-v2/client-dashboard-v2";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ClientPortalV2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (session.isSuperAdmin) {
    redirect({ href: "/client-portal-v2/clients", locale });
  }
  return <ClientDashboardV2 />;
}
