import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VehiclesPageShell } from "@/features/vehicles/vehicles-page-shell";

export default async function VehiclesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ add?: string; tab?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.view");

  return <VehiclesPageShell addOpen={query.add === "1"} tab={query.tab} />;
}
