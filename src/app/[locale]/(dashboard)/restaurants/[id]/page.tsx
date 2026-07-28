import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RestaurantDetailPageShell } from "@/features/restaurants/restaurant-detail-page-shell";

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "restaurants.view");

  return <RestaurantDetailPageShell id={id} />;
}
