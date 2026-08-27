import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsCalendarShell } from "@/features/visits/visits-calendar-shell";

export default async function VisitBookingsCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitsCalendarShell fromEsignHub={from === "requests-esign"} />;
}
