import { setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/app/app-page";
import { RosterUploadShell } from "@/features/roster/roster-upload-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function RosterUploadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.manage");
  return (
    <AppPage>
      <RosterUploadShell />
    </AppPage>
  );
}
