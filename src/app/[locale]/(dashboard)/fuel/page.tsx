import { setRequestLocale } from "next-intl/server";
import { FuelPageShell } from "@/features/fuel/fuel-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";

export default async function FuelPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "fuel.view");
  return <FuelPageShell initialAnchor={kuwaitTodayYmd()} />;
}
