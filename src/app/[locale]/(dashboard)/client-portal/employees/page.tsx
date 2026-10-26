import { setRequestLocale } from "next-intl/server";
import { ClientPortalEmployeesShell } from "@/features/client-portal/client-portal-employees-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { parsePartnerProjectKey } from "@/lib/auth/staff-access";

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
  await requirePermission(locale, "client_portal.view");
  const project = parsePartnerProjectKey(query.project) ?? "keeta";
  const employee = typeof query.employee === "string" ? query.employee : "";
  return <ClientPortalEmployeesShell project={project} employeeId={employee} />;
}
