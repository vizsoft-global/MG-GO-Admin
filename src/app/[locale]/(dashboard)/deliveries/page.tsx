import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { DeliveriesPageShell } from "@/features/deliveries/deliveries-page-shell";

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
