import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsCalendarShell } from "@/features/visits/visits-calendar-shell";

/** EmployeeDesk → Visits → calendar. Re-export of `/visit-bookings/calendar`. */
export default async function EmployeeDeskVisitsCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsCalendarShell />;
}
