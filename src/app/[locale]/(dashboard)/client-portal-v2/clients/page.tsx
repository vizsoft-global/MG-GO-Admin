import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientsV2 } from "@/features/portal-v2/clients-v2";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ClientPortalV2ClientsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  if (session.accessKind === "partner") {
    redirect({ href: "/client-portal-v2", locale });
  }
  return <ClientsV2 />;
}
