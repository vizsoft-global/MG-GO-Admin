import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { TemplateBuilderPageShell } from "@/features/notifications/template-builder-page-shell";

export default async function NotificationTemplateDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.view");
  return <TemplateBuilderPageShell templateId={id} />;
}
