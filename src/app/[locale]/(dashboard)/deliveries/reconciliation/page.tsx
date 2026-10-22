import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { OrderReconPageShell } from "@/features/order-recon/order-recon-page-shell";

/**
 * The compare server action forwards to the scan lane, whose client budget is
 * 120s. Without this segment config the Vercel function can be cut off before
 * that budget is reached, which reads as a generic failure on the page.
 */
export const maxDuration = 300;

export default async function OrderReconPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "order_recon.view");
  void logAdminPageView("/deliveries/reconciliation", "OrderReconPage");
  return <OrderReconPageShell />;
}
