import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ClientPortalShell } from "@/features/client-portal/client-portal-shell";

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "client_portal.view");
  return <ClientPortalShell />;
}
