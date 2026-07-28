import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RestaurantFormPage } from "@/features/restaurants/restaurant-form-page";

export default async function EditRestaurantPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "restaurants.manage");

  return <RestaurantFormPage restaurantId={id} />;
}
