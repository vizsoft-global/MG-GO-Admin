import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsPageShell } from "@/features/visits/visits-page-shell";

/** EmployeeDesk → Visits → All. Re-export of `/visit-bookings/all`. */
export default async function EmployeeDeskVisitsAllPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsPageShell />;
}
