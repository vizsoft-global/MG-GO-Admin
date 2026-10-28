import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientPortalShell } from "@/features/client-portal/client-portal-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (session.isSuperAdmin) {
    redirect({ href: "/client-portal/clients", locale });
  }
  return <ClientPortalShell />;
}
