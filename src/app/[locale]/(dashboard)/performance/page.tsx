import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { PerformancePageShell } from "@/features/performance/performance-page-shell";

export default async function PerformancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.view");

  return <PerformancePageShell />;
}
