import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { TenureSettingsPanel } from "@/features/requests/tenure-settings-panel";

export default async function RequestsTenureSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <TenureSettingsPanel />;
}
