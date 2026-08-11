import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignScreenshotSettingsShell } from "@/features/esign/esign-screenshot-settings-shell";

export default async function EsignScreenshotSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignScreenshotSettingsShell />;
}
