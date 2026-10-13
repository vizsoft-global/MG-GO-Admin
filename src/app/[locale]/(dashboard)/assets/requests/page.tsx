import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function AssetRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "asset_requests.view");
  redirect({ href: "/assets?tab=request", locale });
}
