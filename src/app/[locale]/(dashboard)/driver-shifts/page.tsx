import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverShiftsPageShell } from "@/features/driver-shifts/driver-shifts-page-shell";

  export default async function DriverShiftsPage({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }) {
    const { locale } = await params;
    setRequestLocale(locale);
    await requirePermission(locale, "attendance.view");

    return <DriverShiftsPageShell />;
  }
