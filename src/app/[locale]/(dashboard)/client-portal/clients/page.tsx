import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientsDirectoryShell } from "@/features/client-portal/clients-directory-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ClientPortalClientsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (!session.isSuperAdmin) {
    redirect({
      href: session.accessKind === "partner" ? "/client-portal" : "/unauthorized",
      locale,
    });
  }
  return <ClientsDirectoryShell />;
}
