import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsReportsShell } from "@/features/visits/visits-reports-shell";

export default async function VisitBookingsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsReportsShell />;
}
