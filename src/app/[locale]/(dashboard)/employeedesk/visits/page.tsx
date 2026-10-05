import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsHubShell } from "@/features/visits/visits-hub-shell";

/**
 * EmployeeDesk → Visits.
 *
 * The V1 `/visit-bookings` hub re-exported, per `EMPLOYEEDESK_V2_VISITS.md`:
 * the reference needs a tile and a route alias, not a second visit module. Every
 * `visits.*` slug keeps its meaning and its assignments.
 */
export default async function EmployeeDeskVisitsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsHubShell />;
}
