import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { PayrollClientsPanel } from "@/features/payroll/payroll-clients-panel";
import { listPayrollClients } from "@/features/payroll/payroll-clients-actions";

export default async function PayrollClientsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.manage");
  const t = await getTranslations("pages.settings.payrollClients");
  const rows = await listPayrollClients();
  return <PayrollClientsPanel rows={rows} title={t("title")} subtitle={t("subtitle")} />;
}
