import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AnalyticsPageShell } from "@/features/notifications/analytics-page-shell";

export default async function NotificationAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <AnalyticsPageShell />;
}
