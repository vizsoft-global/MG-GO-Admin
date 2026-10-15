import { setRequestLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeeCatalogPanel } from "@/features/employees/employee-catalog-panel";
import { listEmployeeCatalog } from "@/features/employees/employee-catalogs-actions";

export default async function EmployeeSectionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.manage");
  const t = await getTranslations("pages.settings.employeeCatalogs");
  const rows = await listEmployeeCatalog("employee_sections");
  return <EmployeeCatalogPanel kind="employee_sections" rows={rows} title={t("sectionsTitle")} subtitle={t("sectionsSubtitle")} />;
}
