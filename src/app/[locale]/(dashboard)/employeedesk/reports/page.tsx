import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeeDeskReportsShell } from "@/features/employeedesk/employeedesk-reports-shell";

/**
 * EmployeeDesk → Reports.
 *
 * Gated on `requests.view` to match the menu registry row, not on
 * `requests.manage`. The two reads inside that a viewer cannot make (the
 * department workload table and the visits KPI) degrade in place, so a
 * read-only operator still gets the cross-module picture and the four links
 * instead of a permission wall in front of a mostly-public page.
 */
export default async function EmployeeDeskReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <EmployeeDeskReportsShell />;
}
