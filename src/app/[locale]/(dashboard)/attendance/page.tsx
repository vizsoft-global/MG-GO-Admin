import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AttendancePageShell } from "@/features/attendance/attendance-page-shell";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");

  return <AttendancePageShell />;
}
