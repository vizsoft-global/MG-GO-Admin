import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OperationsDashboardShell } from "@/features/operations-dashboard/operations-dashboard-shell";

export default async function OperationsDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "operations_dashboard.view");
  return <OperationsDashboardShell />;
}
