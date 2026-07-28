import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { TemplateBuilderPageShell } from "@/features/notifications/template-builder-page-shell";

export default async function NewNotificationTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "notifications.manage");
  return <TemplateBuilderPageShell />;
}
