import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientEmployeesV2 } from "@/features/portal-v2/client-employees-v2";
import { requirePermission } from "@/lib/auth/require-permission";
import { resolvePortalProject } from "@/features/client-portal/portal-access";

export default async function ClientPortalV2EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "client_portal.view");
  const resolved = resolvePortalProject(session, query.project);
  if ("error" in resolved) {
    redirect({ href: "/unauthorized", locale });
    return null;
  }
  return <ClientEmployeesV2 project={resolved.projectKey} />;
}
