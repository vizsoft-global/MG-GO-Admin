"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { kuwaitToday } from "./attendance-list-utils";
import { AttendanceDriverExplorePanel } from "./attendance-driver-explore-panel";
import { useDriverAttendanceDetail } from "./use-attendance-table";

export function AttendanceDriverDetailPageShell({ driverId }: { driverId: string }) {
  const t = useTranslations("pages.attendance");
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = kuwaitToday();
  const date = searchParams.get("date") ?? today;

  const { data: dayRow } = useDriverAttendanceDetail(driverId, date);

  return (
    <AppPage>
      <AppPageHeader
        title={dayRow?.driver_name ?? t("driverDetailTitle")}
        description={dayRow ? `${dayRow.driver_code} · ${date}` : date}
        actions={
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href="/attendance">
                <ArrowLeft className="h-4 w-4" />
                {t("backToAttendance")}
              </Link>
            }
          />
        }
      />

      <AttendanceDriverExplorePanel
        driverId={driverId}
        date={date}
        onDateChange={(next) => {
          router.replace(`/attendance/drivers/${driverId}?date=${next}`);
        }}
      />
    </AppPage>
  );
}
