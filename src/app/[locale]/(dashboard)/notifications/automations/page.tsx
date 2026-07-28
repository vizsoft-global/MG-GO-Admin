import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AutomationsListPageShell } from "@/features/notifications/automations-list-page-shell";

export default async function NotificationAutomationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <AutomationsListPageShell />;
}
