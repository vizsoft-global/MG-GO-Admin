import { setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/app/app-page";
import { RosterReportShell } from "@/features/roster/roster-report-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RosterReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");
  return (
    <AppPage>
      <RosterReportShell />
    </AppPage>
  );
}
