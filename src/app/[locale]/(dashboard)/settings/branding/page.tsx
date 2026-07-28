import { setRequestLocale, getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { BrandingSettingsPanel } from "@/features/settings/branding-settings-panel";

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  return <BrandingSettingsPanel />;
}
