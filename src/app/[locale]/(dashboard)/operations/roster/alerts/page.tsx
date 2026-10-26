import { setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/app/app-page";
import { RosterAlertsShell } from "@/features/roster/roster-alerts-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RosterAlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");
  return (
    <AppPage>
      <RosterAlertsShell />
    </AppPage>
  );
}
