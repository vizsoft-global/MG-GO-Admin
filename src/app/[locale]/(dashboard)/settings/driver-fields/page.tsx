import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverFieldsSettingsPanel } from "@/features/custom-fields/driver-fields-settings-panel";

export default async function DriverFieldsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.manage");

  return <DriverFieldsSettingsPanel />;
}
