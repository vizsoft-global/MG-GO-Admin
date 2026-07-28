import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ModuleListShell } from "@/components/dashboard/module-list-shell";
import { Button } from "@/components/ui/button";

export default async function VehiclesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.view");
  const t = await getTranslations("pages.vehicles");

  return (
    <ModuleListShell
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <Button className="cursor-pointer rounded-lg" disabled>
          {t("addVehicle")}
        </Button>
      }
      tabs={[
        { id: "all", label: t("tabAll") },
        { id: "suspended", label: t("tabSuspended") },
        { id: "on-duty", label: t("tabOnDuty") },
      ]}
      activeTabId="all"
      kpis={[
        { label: t("kpiTotal"), value: "—" },
        { label: t("kpiOnDuty"), value: "—" },
        { label: t("kpiSuspended"), value: "—" },
        { label: t("kpiGroup"), value: "—" },
        { label: t("kpiRent"), value: "—" },
        { label: t("kpiMaintenance"), value: "—" },
      ]}
      columns={[t("colBikeId"), t("colReg"), t("colDriver"), t("colType"), t("colStatus")]}
      emptyTitle={t("emptyTitle")}
    />
  );
}
