import { setRequestLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EmployeeCatalogPanel } from "@/features/employees/employee-catalog-panel";
import { listEmployeeCatalog } from "@/features/employees/employee-catalogs-actions";

export default async function JobPositionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.manage");
  const t = await getTranslations("pages.settings.employeeCatalogs");
  const rows = await listEmployeeCatalog("job_positions");
  return (
    <EmployeeCatalogPanel
      kind="job_positions"
      rows={rows}
      title={t("jobPositionsTitle")}
      subtitle={t("jobPositionsSubtitle")}
    />
  );
}
