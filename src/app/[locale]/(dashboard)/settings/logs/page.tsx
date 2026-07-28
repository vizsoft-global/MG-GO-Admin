import { setRequestLocale } from "next-intl/server";
import { ActivityLogsPageShell } from "@/features/settings/activity-logs-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";

export default async function ActivityLogsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "audit.view");
  void logAdminPageView("/settings/logs", "ActivityLogsPage");

  return <ActivityLogsPageShell />;
}
