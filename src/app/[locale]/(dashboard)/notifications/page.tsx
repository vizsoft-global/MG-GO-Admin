import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { NotificationsPageShell } from "@/features/notifications/notifications-page-shell";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return (
    <Suspense fallback={null}>
      <NotificationsPageShell />
    </Suspense>
  );
}
