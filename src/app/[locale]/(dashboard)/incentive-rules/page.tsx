import { setRequestLocale } from "next-intl/server";
import { IncentiveRulesPageShell } from "@/features/dpd/incentive-rules-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function IncentiveRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");

  return <IncentiveRulesPageShell />;
}
