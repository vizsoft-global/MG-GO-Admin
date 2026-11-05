import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { kuwaitClockMinutes } from "@/lib/date/kuwait-clock";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { VisitsHubShell } from "@/features/visits/visits-hub-shell";

export default async function VisitBookingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");

  // The hub's "Today" strip reads the operator's Kuwait clock. Rendering it from
  // the server keeps the first paint stable — the shell only ticks after mount,
  // so a minute boundary cannot turn into a hydration mismatch.
  return <VisitsHubShell today={kuwaitTodayYmd()} nowMinutes={kuwaitClockMinutes()} />;
}
