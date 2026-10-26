import { setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/app/app-page";
import { RosterPageShell } from "@/features/roster/roster-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RosterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");
  return (
    <AppPage>
      <RosterPageShell />
    </AppPage>
  );
}
