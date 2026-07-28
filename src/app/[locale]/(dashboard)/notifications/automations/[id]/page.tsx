import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AutomationBuilderPageShell } from "@/features/notifications/automation-builder-page-shell";

export default async function NotificationAutomationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <AutomationBuilderPageShell automationId={id} />;
}
