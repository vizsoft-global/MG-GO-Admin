import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { DataCleanupPanel } from "@/features/settings/data-cleanup-panel";

export default async function DataCleanupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);

  return <DataCleanupPanel />;
}
