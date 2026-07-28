import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ModuleListShell } from "@/components/dashboard/module-list-shell";

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  const t = await getTranslations("pages.requests");

  return (
    <ModuleListShell
      title={t("title")}
      subtitle={t("subtitle")}
      tabs={[
        { id: "loan", label: t("tabLoan") },
        { id: "leave", label: t("tabLeave") },
        { id: "fuel", label: t("tabFuel") },
        { id: "complaints", label: t("tabComplaints") },
        { id: "documents", label: t("tabDocuments") },
      ]}
      activeTabId="loan"
      kpis={[
        { label: t("kpiPending"), value: "—" },
        { label: t("kpiApproved"), value: "—" },
        { label: t("kpiRejected"), value: "—" },
        { label: t("kpiLoan"), value: "—" },
        { label: t("kpiFuel"), value: "—" },
        { label: t("kpiLeave"), value: "—" },
      ]}
      columns={[t("colCode"), t("colDriver"), t("colType"), t("colAmount"), t("colStatus"), t("colDate")]}
      emptyTitle={t("emptyTitle")}
    />
  );
}
