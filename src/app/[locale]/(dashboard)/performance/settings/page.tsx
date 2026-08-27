import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { PerformanceSettingsPanel } from "@/features/performance/performance-settings-panel";

export default async function PerformanceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  return <PerformanceSettingsPanel />;
}
