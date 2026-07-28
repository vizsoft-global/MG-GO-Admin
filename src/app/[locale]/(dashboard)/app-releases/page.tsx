import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppReleasesPageShell } from "@/features/app-releases/app-releases-page-shell";

export default async function AppReleasesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "releases.manage");

  return <AppReleasesPageShell />;
}
