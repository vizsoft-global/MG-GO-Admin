import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DashboardPageShell } from "@/features/dashboard/dashboard-page-shell";

export default async function DashboardOpsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "dashboard.view");
  return <DashboardPageShell locale={locale} />;
}
