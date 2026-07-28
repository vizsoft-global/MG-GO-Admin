import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AssetsPageShell } from "@/features/assets/assets-page-shell";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "assets.view");

  return <AssetsPageShell />;
}
