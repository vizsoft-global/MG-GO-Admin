import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsDepartmentsShell } from "@/features/visits/visits-departments-shell";

/** EmployeeDesk → Visits → departments. Re-export of `/visit-bookings/departments`. */
export default async function EmployeeDeskVisitsDepartmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.manage_catalog");
  return <VisitsDepartmentsShell />;
}
