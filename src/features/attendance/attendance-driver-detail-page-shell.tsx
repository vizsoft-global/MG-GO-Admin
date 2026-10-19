"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { kuwaitToday } from "./attendance-list-utils";
import { AttendanceCheckInCell } from "./attendance-check-in-cell";
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

      {dayRow ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("colCheckInPhoto")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <AttendanceCheckInCell
              photoKey={dayRow.check_in_photo_key}
              restaurantName={dayRow.check_in_restaurant_name}
              distanceM={dayRow.check_in_distance_m}
            />
            {dayRow.check_in_photo_at ? (
              <span className="text-[11px] text-muted-foreground">
                {new Date(dayRow.check_in_photo_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

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
