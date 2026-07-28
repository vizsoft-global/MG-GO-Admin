"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AttendancePill } from "@/features/drivers/driver-list-ui";
import { AttendanceCorrectionSheet } from "@/features/attendance/attendance-correction-sheet";
import { TrackingTableToolbar } from "@/features/driver-tracking/table-toolbar";
import { downloadCsv } from "@/features/driver-tracking/csv-export";
import { addDays, formatDurationSeconds, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import type { WorktimeListRow } from "@/features/driver-tracking/tracking-read-actions";
import {
  formatKuwaitTime,
  formatScheduledShiftRange,
  formatVsScheduled,
} from "@/features/driver-tracking/shift-adherence-display";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useDriverFormOptions } from "@/features/drivers/use-driver-form-options";
import { partnerSearchOptions, zoneSearchOptions } from "@/lib/search-options";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { useWorktimeList } from "./use-worktime";
import {
  WORKTIME_SORT_KEYS,
  exportWorktimeCsv,
  filterWorktime,
  sortWorktime,
  type WorktimeSortKey,
} from "./worktime-list-utils";
import type { AttendanceListRow } from "@/features/attendance/types";

function actualInIso(row: WorktimeListRow): string | null {
  return row.shift_adherence?.actual_in_at ?? row.first_online_at ?? row.check_in_at;
}

function actualOutIso(row: WorktimeListRow): string | null {
  return row.shift_adherence?.actual_out_at ?? row.check_out_at;
}

function scheduledShiftLabel(row: WorktimeListRow): string {
  if (row.shift_adherence) {
    return formatScheduledShiftRange(
      row.shift_adherence.scheduled_start_at,
      row.shift_adherence.scheduled_end_at,
    );
  }
  if (row.session1_label) {
    return row.session2_label
      ? `${row.session1_label} / ${row.session2_label}`
      : row.session1_label;
  }
  return "—";
}

export function WorktimePageShell() {
  const t = useTranslations("pages.worktime");
  const { can } = useAuth();
  const canManage = can("attendance.manage");
  const today = kuwaitToday();
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");
  const [validationStatus, setValidationStatus] = useState<
    "all" | "present" | "online_unvalidated" | "absent"
  >("all");
  const [onDuty, setOnDuty] = useState<"all" | "yes" | "no">("all");
  const [hasLog, setHasLog] = useState<"all" | "yes" | "no">("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [sortKey, setSortKey] = useState<WorktimeSortKey>("date_desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [correctionRow, setCorrectionRow] = useState<AttendanceListRow | null>(null);
  const queryClient = useQueryClient();
  const { data: formOptions } = useDriverFormOptions();

  const { data: rows = [], isLoading } = useWorktimeList({
    fromDate,
    toDate,
    zoneId: zoneFilter,
    partnerId: partnerFilter,
  });

  const filtered = useMemo(
    () =>
      sortWorktime(
        filterWorktime(rows, search, validationStatus, onDuty, hasLog),
        sortKey,
      ),
    [rows, search, validationStatus, onDuty, hasLog, sortKey],
  );

  const sortItems = WORKTIME_SORT_KEYS.map((key) => ({
    value: key,
    label: t(`sort.${key}`),
  }));

  async function handleRefresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.worktime.all() });
    setIsRefreshing(false);
  }

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppListCard>
        <TrackingTableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("searchPlaceholder")}
          sortValue={sortKey}
          onSortChange={(v) => setSortKey(v as WorktimeSortKey)}
          sortItems={sortItems}
          onRefresh={() => void handleRefresh()}
          isRefreshing={isRefreshing}
          onExport={() =>
            downloadCsv(`worktime-${fromDate}-${toDate}.csv`, exportWorktimeCsv(filtered))
          }
          exportDisabled={filtered.length === 0}
          dateSlot={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[140px]"
              />
              <span className="text-muted-foreground text-sm">{t("to")}</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[140px]"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setToDate(today)}>
                {t("today")}
              </Button>
            </div>
          }
          filterSlot={
            <>
              <SearchSelect
                value={zoneFilter}
                onChange={(v) => setZoneFilter(v ?? "all")}
                items={[
                  { value: "all", label: t("filterZoneAll"), keywords: [] },
                  ...zoneSearchOptions(formOptions?.zones ?? []),
                ]}
                placeholder={t("filterZone")}
                className="w-full sm:w-[160px]"
              />
              <SearchSelect
                value={partnerFilter}
                onChange={(v) => setPartnerFilter(v ?? "all")}
                items={[
                  { value: "all", label: t("filterPartnerAll"), keywords: [] },
                  ...partnerSearchOptions(formOptions?.partners ?? []),
                ]}
                placeholder={t("filterPartner")}
                className="w-full sm:w-[160px]"
              />
              <Select
                value={validationStatus}
                onValueChange={(v) => setValidationStatus(v as typeof validationStatus)}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterValidationAll")}</SelectItem>
                  <SelectItem value="present">{t("validationPresent")}</SelectItem>
                  <SelectItem value="online_unvalidated">{t("validationUnvalidated")}</SelectItem>
                  <SelectItem value="absent">{t("validationAbsent")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={onDuty} onValueChange={(v) => setOnDuty(v as typeof onDuty)}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterOnDutyAll")}</SelectItem>
                  <SelectItem value="yes">{t("onDutyYes")}</SelectItem>
                  <SelectItem value="no">{t("onDutyNo")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={hasLog} onValueChange={(v) => setHasLog(v as typeof hasLog)}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterLogAll")}</SelectItem>
                  <SelectItem value="yes">{t("hasLogYes")}</SelectItem>
                  <SelectItem value="no">{t("hasLogNo")}</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDate")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colScheduledShift")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colActualIn")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colActualOut")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colLate")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colEarlyOut")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS} title={t("sourceLog")}>
                    {t("colCheckIn")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colCheckOut")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS} title={t("sourceLog")}>
                    {t("colLogDuration")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS} title={t("sourceApp")}>
                    {t("colOnline")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colScheduledDuration")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colVsScheduled")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS} title={t("sourceGps")}>
                    {t("colIdleMoving")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colValidation")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colOnDuty")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <div className="font-medium">{row.driver_name}</div>
                      <div className="text-muted-foreground text-xs">{row.driver_code}</div>
                    </TableCell>
                    <TableCell>{row.attendance_date}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {scheduledShiftLabel(row)}
                    </TableCell>
                    <TableCell>{formatKuwaitTime(actualInIso(row))}</TableCell>
                    <TableCell>{formatKuwaitTime(actualOutIso(row))}</TableCell>
                    <TableCell>
                      {row.shift_adherence && row.shift_adherence.minutes_late > 0 ? (
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          {row.shift_adherence.minutes_late}
                        </span>
                      ) : (
                        row.shift_adherence ? "0" : "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {row.shift_adherence && row.shift_adherence.minutes_early_out > 0 ? (
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          {row.shift_adherence.minutes_early_out}
                        </span>
                      ) : (
                        row.shift_adherence ? "0" : "—"
                      )}
                    </TableCell>
                    <TableCell>{formatKuwaitTime(row.check_in_at)}</TableCell>
                    <TableCell>{formatKuwaitTime(row.check_out_at)}</TableCell>
                    <TableCell>
                      {row.log_duration_seconds != null
                        ? formatDurationSeconds(row.log_duration_seconds)
                        : "—"}
                    </TableCell>
                    <TableCell title={t("sourceApp")}>
                      {formatDurationSeconds(row.online_seconds)}
                      {row.session_count > 0 ? (
                        <span className="text-muted-foreground ms-1 text-xs">
                          ({row.session_count})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.shift_adherence
                        ? formatDurationSeconds(row.shift_adherence.scheduled_seconds)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {row.shift_adherence
                        ? formatVsScheduled(
                            row.online_seconds,
                            row.shift_adherence.scheduled_seconds,
                          )
                        : "—"}
                    </TableCell>
                    <TableCell title={t("sourceGps")}>
                      {row.idle_minutes != null || row.moving_minutes != null
                        ? `${row.idle_minutes ?? 0}m / ${row.moving_minutes ?? 0}m`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {row.attendance_status ? (
                        <StatusPill
                          variant={
                            row.attendance_status === "present"
                              ? "success"
                              : row.attendance_status === "online_unvalidated"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {row.attendance_status}
                        </StatusPill>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <AttendancePill
                        onDuty={row.is_on_duty}
                        onDutyLabel={t("onDutyYes")}
                        offDutyLabel={t("onDutyNo")}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          render={<Link href={`/drivers/${row.driver_id}`} />}
                        >
                          {t("viewDriver")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <Link
                              href={`/live-tracking?driverId=${row.driver_id}&historyDate=${row.attendance_date}`}
                            />
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setCorrectionRow({
                                id: row.log_id,
                                driver_id: row.driver_id,
                                driver_name: row.driver_name,
                                driver_code: row.driver_code,
                                driver_phone: row.driver_phone,
                                log_date: row.attendance_date,
                                check_in_at: row.check_in_at,
                                check_out_at: row.check_out_at,
                                distance_meters: row.distance_meters,
                                status: "present",
                                zone_compliance: null,
                                admin_note: null,
                                is_on_duty: row.is_on_duty,
                                is_active_now: false,
                                is_exception: false,
                                app_attendance_status: row.attendance_status,
                                online_seconds_today: row.online_seconds,
                                shift_adherence: row.shift_adherence,
                                scheduled_shift_label: scheduledShiftLabel(row),
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </AppListCard>
      <AttendanceCorrectionSheet
        row={correctionRow}
        open={Boolean(correctionRow)}
        onOpenChange={(open) => !open && setCorrectionRow(null)}
        createMode={!correctionRow?.id}
      />
    </AppPage>
  );
}
