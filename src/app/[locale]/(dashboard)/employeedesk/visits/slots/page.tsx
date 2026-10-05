import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsSlotsShell } from "@/features/visits/visits-slots-shell";

/** EmployeeDesk → Visits → slots. Re-export of `/visit-bookings/slots`. */
export default async function EmployeeDeskVisitsSlotsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.manage_catalog");
  return <VisitsSlotsShell />;
}
