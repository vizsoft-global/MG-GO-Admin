import { setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/app/app-page";
import { RosterChangesShell } from "@/features/roster/roster-changes-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RosterChangesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");
  return (
    <AppPage>
      <RosterChangesShell />
    </AppPage>
  );
}
