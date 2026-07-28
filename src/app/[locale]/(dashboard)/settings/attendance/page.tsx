import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AttendanceSettingsPanel } from "@/features/attendance/attendance-settings-panel";

export default async function AttendanceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.manage");

  return <AttendanceSettingsPanel />;
}
