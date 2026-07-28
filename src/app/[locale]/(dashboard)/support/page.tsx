import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ModuleListShell } from "@/components/dashboard/module-list-shell";

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "support.view");
  const t = await getTranslations("pages.support");

  return (
    <ModuleListShell
      title={t("title")}
      subtitle={t("subtitle")}
      tabs={[
        { id: "conversations", label: t("tabConversations") },
        { id: "tickets", label: t("tabTickets") },
        { id: "appointments", label: t("tabAppointments") },
        { id: "history", label: t("tabHistory") },
      ]}
      activeTabId="conversations"
      kpis={[
        { label: t("kpiOpenChats"), value: "—" },
        { label: t("kpiTickets"), value: "—" },
        { label: t("kpiAppointments"), value: "—" },
        { label: t("kpiResolved"), value: "—" },
        { label: t("kpiAvgResponse"), value: "—" },
        { label: t("kpiSos"), value: "—" },
      ]}
      columns={[t("colDriver"), t("colSubject"), t("colStatus"), t("colUpdated")]}
      emptyTitle={t("emptyTitle")}
    />
  );
}
