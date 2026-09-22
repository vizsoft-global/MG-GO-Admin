import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { OrderReconPageShell } from "@/features/order-recon/order-recon-page-shell";

export default async function OrderReconPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "deliveries.view");
  void logAdminPageView("/deliveries/reconciliation", "OrderReconPage");
  return <OrderReconPageShell />;
}
