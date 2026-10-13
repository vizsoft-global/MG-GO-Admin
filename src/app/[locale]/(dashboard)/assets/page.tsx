import { setRequestLocale } from "next-intl/server";
import { AssetsPageShell } from "@/features/assets/assets-page-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["assets.view", "asset_requests.view"]);

  return <AssetsPageShell />;
}
