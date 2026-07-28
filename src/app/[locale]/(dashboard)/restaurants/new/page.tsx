import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RestaurantFormPage } from "@/features/restaurants/restaurant-form-page";

export default async function NewRestaurantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "restaurants.manage");

  return <RestaurantFormPage />;
}
