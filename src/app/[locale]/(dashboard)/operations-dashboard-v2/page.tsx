import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OperationsV2Shell } from "@/features/operations-dashboard-v2/operations-v2-shell";

export default async function OperationsDashboardV2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "operations_dashboard.view");
  return <OperationsV2Shell />;
}
