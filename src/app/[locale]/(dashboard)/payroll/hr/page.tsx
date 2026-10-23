import { setRequestLocale } from "next-intl/server";
import { HrPayrollPageShell } from "@/features/payroll/hr-payroll-page-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function HrPayrollPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["payroll.hr_payroll", "payroll.manage"]);
  return <HrPayrollPageShell />;
}
