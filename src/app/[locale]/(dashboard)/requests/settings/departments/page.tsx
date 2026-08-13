import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DepartmentsSettingsPanel } from "@/features/requests/departments-settings-panel";

export default async function RequestsDepartmentsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <DepartmentsSettingsPanel />;
}
