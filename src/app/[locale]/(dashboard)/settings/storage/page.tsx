import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { getSessionUser } from "@/lib/auth/get-session";
import { StorageSettingsPanel } from "@/features/settings/storage-settings-panel";

export default async function StorageSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    redirect(`/${locale}/unauthorized`);
  }

  return <StorageSettingsPanel />;
}
