import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsReportsShell } from "@/features/visits/visits-reports-shell";

/**
 * EmployeeDesk → Visits → reports. Re-export of `/visit-bookings/reports`.
 *
 * The EmployeeDesk Reports page links here for the visit half of its numbers
 * rather than re-deriving them, so one visit total cannot disagree with another.
 */
export default async function EmployeeDeskVisitsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsReportsShell />;
}
