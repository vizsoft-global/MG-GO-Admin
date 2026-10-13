import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function FuelRefundsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "fuel_refunds.view");
  redirect({ href: "/fuel?tab=refund", locale });
}
