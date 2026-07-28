import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { NotificationDetailPageShell } from "@/features/notifications/notification-detail-page-shell";

export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <NotificationDetailPageShell campaignId={id} />;
}
