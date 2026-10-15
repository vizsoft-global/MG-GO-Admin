import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeeCatalogPanel } from "@/features/employees/employee-catalog-panel";
import { listEmployeeCatalog } from "@/features/employees/employee-catalogs-actions";

export default async function EmployeeStatusesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.manage");
  const t = await getTranslations("pages.settings.employeeCatalogs");
  const rows = await listEmployeeCatalog("employee_statuses");
  return <EmployeeCatalogPanel kind="employee_statuses" rows={rows} title={t("statusesTitle")} subtitle={t("statusesSubtitle")} />;
}
