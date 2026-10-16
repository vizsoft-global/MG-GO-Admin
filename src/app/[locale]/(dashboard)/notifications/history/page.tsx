import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { NotificationHistoryPageShell } from "@/features/notifications/history-page-shell";

/**
 * The History tab used to `redirect()` back to the notifications overview, so a
 * bookmark or a breadcrumb to it landed on the wrong page. It now mounts the
 * same shell the breadcrumb names.
 */
export default async function NotificationHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <NotificationHistoryPageShell />;
}
