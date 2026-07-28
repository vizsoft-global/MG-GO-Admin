import { setRequestLocale } from "next-intl/server";
import { PayoutsPageShell } from "@/features/payouts/payouts-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";

export default async function PayoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");
  void logAdminPageView("/payouts", "PayoutsPage");

  return <PayoutsPageShell />;
}
