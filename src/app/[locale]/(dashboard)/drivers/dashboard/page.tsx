import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeesDashboardShell } from "@/features/employees/employees-dashboard-shell";

export default async function EmployeesDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.view");
  return <EmployeesDashboardShell />;
}
