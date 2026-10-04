import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { IncentiveRuleDetailPageShell } from "@/features/dpd/incentive-rule-detail-page-shell";
import { getIncentiveRuleById } from "@/features/dpd/dpd-actions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function IncentiveRuleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");

  const rule = await getIncentiveRuleById(id);
  if (!rule) notFound();

  return <IncentiveRuleDetailPageShell rule={rule} />;
}
