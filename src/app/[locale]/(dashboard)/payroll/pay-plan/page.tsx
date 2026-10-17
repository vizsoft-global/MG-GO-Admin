import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverPayPlanPageShell } from "@/features/payroll/driver-pay-plan-page-shell";

export default async function PayPlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "payroll.view");

  return <DriverPayPlanPageShell />;
}
