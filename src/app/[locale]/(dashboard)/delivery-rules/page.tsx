import { setRequestLocale } from "next-intl/server";
import { DeliveryRulesPageShell } from "@/features/dpd/delivery-rules-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function DeliveryRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");

  return <DeliveryRulesPageShell />;
}
