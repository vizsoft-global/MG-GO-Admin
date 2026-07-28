import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { AttendanceDriverDetailPageShell } from "@/features/attendance/attendance-driver-detail-page-shell";

export default async function AttendanceDriverDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "attendance.view");

  return <AttendanceDriverDetailPageShell driverId={id} />;
}
