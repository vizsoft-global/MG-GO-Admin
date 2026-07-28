import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { fetchDashboardSnapshot } from "@/features/dashboard/dashboard-actions";
import { DashboardPageShell } from "@/features/dashboard/dashboard-page-shell";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "dashboard.view");

  const snapshot = await fetchDashboardSnapshot(locale);

  return <DashboardPageShell initialSnapshot={snapshot} locale={locale} />;
}
