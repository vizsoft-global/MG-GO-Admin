import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { TemplatesListPageShell } from "@/features/notifications/templates-list-page-shell";

export default async function NotificationTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <TemplatesListPageShell />;
}
