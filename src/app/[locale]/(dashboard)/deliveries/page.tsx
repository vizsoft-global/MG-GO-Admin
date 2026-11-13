import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { DeliveriesPageShell } from "@/features/deliveries/deliveries-page-shell";

/**
 * The page's list is fetched through a server action, and a wide filter can read
 * a month of deliveries. Without a budget the platform default killed the request
 * and the client showed nothing, which read as "the filter does nothing".
 */
export const maxDuration = 300;

export default async function DeliveriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "deliveries.view");
  void logAdminPageView("/deliveries", "DeliveriesPage");

  return <DeliveriesPageShell />;
}
