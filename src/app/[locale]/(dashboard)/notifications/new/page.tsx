import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { CreateNotificationPageShell } from "@/features/notifications/create-notification-page-shell";

export default async function NewNotificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.manage");
  return <CreateNotificationPageShell />;
}
