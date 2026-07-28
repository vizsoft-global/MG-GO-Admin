"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  LIVE_STATUS_LABEL_KEYS,
  formatDateTimeKuwait,
  formatDurationSeconds,
} from "./attendance-list-utils";
import type { AttendanceDailyRow } from "./attendance-reporting-types";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";

export function AttendanceDetailDrawer({
  row,
  open,
  onOpenChange,
}: {
  row: AttendanceDailyRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.attendance");

  if (!row) return null;

  const liveLabelKey = LIVE_STATUS_LABEL_KEYS[row.live_status] ?? "livePresent";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.driver_name}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {row.driver_code}
            {row.employee_id ? ` · ${row.employee_id}` : ""}
          </p>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill variant={resolveStatusVariant(row.live_status)}>
              {t(liveLabelKey)}
            </StatusPill>
            {row.is_on_duty ? (
              <StatusPill variant="success">{t("onDuty")}</StatusPill>
            ) : (
              <StatusPill variant="neutral">{t("offDuty")}</StatusPill>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("colDate")}</dt>
              <dd className="font-medium">{row.log_date}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colCheckIn")}</dt>
              <dd className="font-medium">{formatDateTimeKuwait(row.check_in_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colCheckOut")}</dt>
              <dd className="font-medium">{formatDateTimeKuwait(row.check_out_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colScheduledShift")}</dt>
              <dd className="font-medium">
                {row.scheduled_start_at
                  ? `${formatDateTimeKuwait(row.scheduled_start_at)} – ${formatDateTimeKuwait(row.scheduled_end_at)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colOnline")}</dt>
              <dd className="font-medium">{formatDurationSeconds(row.online_seconds)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colDuty")}</dt>
              <dd className="font-medium">{formatDurationSeconds(row.duty_seconds)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colLate")}</dt>
              <dd className="font-medium">{row.minutes_late > 0 ? row.minutes_late : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("kpiCompliance")}</dt>
              <dd className="font-medium">
                {row.compliance_score != null ? `${row.compliance_score}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colLastSeen")}</dt>
              <dd className="font-medium">{formatDateTimeKuwait(row.last_seen_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("filterPartner")}</dt>
              <dd className="font-medium">{row.partner_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("filterZone")}</dt>
              <dd className="font-medium">{row.zone_name ?? "—"}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" render={
              <Link href={`/attendance/drivers/${row.driver_id}?date=${row.log_date}`}>
                {t("viewDetail")}
              </Link>
            } />
            <Button variant="outline" size="sm" render={
              <Link href={`/live-tracking?driver=${row.driver_id}`}>
                <ExternalLink className="h-4 w-4" />
                {t("viewOnMap")}
              </Link>
            } />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
