import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsCalendarShell } from "@/features/visits/visits-calendar-shell";

export default async function VisitBookingsCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsCalendarShell />;
}
