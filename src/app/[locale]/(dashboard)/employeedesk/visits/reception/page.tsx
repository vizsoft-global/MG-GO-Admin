import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsReceptionShell } from "@/features/visits/visits-reception-shell";

/** EmployeeDesk → Visits → reception. Re-export of `/visit-bookings/reception`. */
export default async function EmployeeDeskVisitsReceptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.operate");
  return <VisitsReceptionShell />;
}
