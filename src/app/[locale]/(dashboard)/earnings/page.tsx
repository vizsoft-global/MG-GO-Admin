import { setRequestLocale } from "next-intl/server";
import { EarningsPageShell } from "@/features/earnings/earnings-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";

export default async function EarningsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");
  void logAdminPageView("/earnings", "EarningsPage");

  return <EarningsPageShell />;
}
