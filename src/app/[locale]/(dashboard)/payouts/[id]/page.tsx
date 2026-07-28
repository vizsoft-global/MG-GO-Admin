import { setRequestLocale } from "next-intl/server";
import { PayoutDetailPageShell } from "@/features/payouts/payout-detail-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";

export default async function PayoutDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");
  void logAdminPageView(`/payouts/${id}`, "PayoutDetailPage");

  return <PayoutDetailPageShell runId={id} />;
}
