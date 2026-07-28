import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { RESTAURANTS_VIEW_PERMISSIONS } from "@/lib/auth/permissions";
import { RestaurantsPageShell } from "@/features/restaurants/restaurants-page-shell";

export default async function RestaurantsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, RESTAURANTS_VIEW_PERMISSIONS);

  return <RestaurantsPageShell />;
}
