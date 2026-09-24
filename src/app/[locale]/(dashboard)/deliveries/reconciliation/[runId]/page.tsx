import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { OrderReconDetailShell } from "@/features/order-recon/order-recon-detail-shell";

export default async function OrderReconRunPage({
  params,
}: {
  params: Promise<{ locale: string; runId: string }>;
}) {
  const { locale, runId } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "deliveries.view");
  void logAdminPageView(`/deliveries/reconciliation/${runId}`, "OrderReconRunPage");
  return <OrderReconDetailShell runId={runId} />;
}
