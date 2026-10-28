import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ClientPortalEmployeesShell } from "@/features/client-portal/client-portal-employees-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { resolvePortalProject } from "@/features/client-portal/portal-access";

export default async function ClientPortalEmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ project?: string; employee?: string }>;
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
  const employee = typeof query.employee === "string" ? query.employee : "";
  return <ClientPortalEmployeesShell project={resolved.projectKey} employeeId={employee} />;
}
