import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ModuleListShell } from "@/components/dashboard/module-list-shell";

export default async function WrongActionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "wrong_actions.view");
  const t = await getTranslations("pages.wrongActions");

  return (
    <ModuleListShell
      title={t("title")}
      subtitle={t("subtitle")}
      kpis={[
        { label: t("kpiTotal"), value: "—" },
        { label: t("kpiHigh"), value: "—" },
        { label: t("kpiMedium"), value: "—" },
        { label: t("kpiLow"), value: "—" },
        { label: t("kpiThisWeek"), value: "—" },
        { label: t("kpiPenalties"), value: "—" },
      ]}
      columns={[t("colDriver"), t("colType"), t("colSeverity"), t("colDate"), t("colSource")]}
      emptyTitle={t("emptyTitle")}
    />
  );
}
