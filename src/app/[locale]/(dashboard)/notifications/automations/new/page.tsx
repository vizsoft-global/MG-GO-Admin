import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AutomationBuilderPageShell } from "@/features/notifications/automation-builder-page-shell";

export default async function NewNotificationAutomationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.manage");
  return <AutomationBuilderPageShell />;
}
