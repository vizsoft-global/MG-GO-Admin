import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RolesSettingsPanel } from "@/features/requests/roles-settings-panel";

export default async function RequestsRolesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <RolesSettingsPanel />;
}
