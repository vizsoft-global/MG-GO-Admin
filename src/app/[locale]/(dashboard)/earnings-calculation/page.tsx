import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";

export default async function EarningsCalculationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "earnings.view");
  void logAdminPageView("/earnings-calculation", "EarningsCalculationPage");
  redirect(`/${locale}/earnings?tab=tools`);
}
