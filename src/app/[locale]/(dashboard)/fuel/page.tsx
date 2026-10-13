import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { FuelHubShell } from "@/features/fuel/fuel-hub-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";

export default async function FuelPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, [
    "fuel.view",
    "fuel_requests.view",
    "fuel_refunds.view",
  ]);
  return (
    <Suspense>
      <FuelHubShell initialAnchor={kuwaitTodayYmd()} />
    </Suspense>
  );
}
