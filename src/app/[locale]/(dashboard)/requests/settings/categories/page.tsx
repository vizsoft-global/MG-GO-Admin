import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { CategoriesSettingsPanel } from "@/features/requests/categories-settings-panel";

export default async function RequestsCategoriesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <CategoriesSettingsPanel />;
}
