"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AttendancePill } from "@/features/drivers/driver-list-ui";
import { TrackingTableToolbar } from "@/features/driver-tracking/table-toolbar";
import { downloadCsv } from "@/features/driver-tracking/csv-export";
import { addDays, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { formatKuwaitDateTime, formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { Link } from "@/i18n/navigation";
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
import { useDriverShiftsList } from "./use-driver-shifts";
import {
  DRIVER_SHIFTS_SORT_KEYS,
  exportDriverShiftsCsv,
  filterShifts,
  sortShifts,
  type DriverShiftsSortKey,
} from "./driver-shifts-list-utils";

export function DriverShiftsPageShell() {
  const t = useTranslations("pages.driverShifts");
  const today = kuwaitToday();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");
  const [shiftType, setShiftType] = useState<"all" | "single" | "split">("all");
  const [withinWindow, setWithinWindow] = useState<"all" | "yes" | "no">("all");
  const [locked, setLocked] = useState<"all" | "yes" | "no">("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [sortKey, setSortKey] = useState<DriverShiftsSortKey>("date_desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { data: formOptions } = useDriverFormOptions();

  const { data: rows = [], isLoading } = useDriverShiftsList({
    fromDate,
    toDate,
    zoneId: zoneFilter,
    partnerId: partnerFilter,
  });

  const filtered = useMemo(
    () => sortShifts(filterShifts(rows, search, shiftType, withinWindow, locked), sortKey),
    [rows, search, shiftType, withinWindow, locked, sortKey],
  );

  const sortItems = DRIVER_SHIFTS_SORT_KEYS.map((key) => ({
    value: key,
    label: t(`sort.${key}`),
  }));

  const zoneItems = useMemo(
    () => [
      { value: "all", label: t("filterZoneAll"), keywords: [t("filterZoneAll")] },
      ...zoneSearchOptions(formOptions?.zones ?? []),
    ],
    [formOptions?.zones, t],
  );

  const partnerItems = useMemo(
    () => [
      { value: "all", label: t("filterPartnerAll"), keywords: [t("filterPartnerAll")] },
      ...partnerSearchOptions(formOptions?.partners ?? []),
    ],
    [formOptions?.partners, t],
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.driverShifts.all() });
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
          onSortChange={(v) => setSortKey(v as DriverShiftsSortKey)}
          sortItems={sortItems}
          onRefresh={() => void handleRefresh()}
          isRefreshing={isRefreshing}
          onExport={() =>
            downloadCsv(`driver-shifts-${fromDate}-${toDate}.csv`, exportDriverShiftsCsv(filtered))
          }
          exportDisabled={filtered.length === 0}
          dateSlot={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[140px]"
                aria-label={t("fromDate")}
              />
              <span className="text-muted-foreground text-sm">{t("to")}</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[140px]"
                aria-label={t("toDate")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFromDate(today);
                  setToDate(today);
                }}
              >
                {t("today")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFromDate(addDays(today, -6));
                  setToDate(today);
                }}
              >
                {t("last7Days")}
              </Button>
            </div>
          }
          filterSlot={
            <>
              <SearchSelect
                value={zoneFilter}
                onChange={(v) => setZoneFilter(v ?? "all")}
                items={zoneItems}
                placeholder={t("filterZone")}
                className="w-full sm:w-[180px]"
              />
              <SearchSelect
                value={partnerFilter}
                onChange={(v) => setPartnerFilter(v ?? "all")}
                items={partnerItems}
                placeholder={t("filterPartner")}
                className="w-full sm:w-[180px]"
              />
              <Select value={shiftType} onValueChange={(v) => setShiftType(v as typeof shiftType)}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterTypeAll")}</SelectItem>
                  <SelectItem value="single">{t("typeSingle")}</SelectItem>
                  <SelectItem value="split">{t("typeSplit")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={withinWindow}
                onValueChange={(v) => setWithinWindow(v as typeof withinWindow)}
              >
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterWindowAll")}</SelectItem>
                  <SelectItem value="yes">{t("inWindowYes")}</SelectItem>
                  <SelectItem value="no">{t("inWindowNo")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={locked} onValueChange={(v) => setLocked(v as typeof locked)}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterLockedAll")}</SelectItem>
                  <SelectItem value="yes">{t("lockedYes")}</SelectItem>
                  <SelectItem value="no">{t("lockedNo")}</SelectItem>
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
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colType")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSession1")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSession2")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSubmittedAt")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colShiftEnds")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colShiftStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colLate")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colEarlyOut")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colInWindow")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colLocked")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colOnDuty")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.driver_name}</div>
                      <div className="text-muted-foreground text-xs">{row.driver_code}</div>
                    </TableCell>
                    <TableCell>{row.shift_date}</TableCell>
                    <TableCell>{row.shift_type}</TableCell>
                    <TableCell>{row.session1_label}</TableCell>
                    <TableCell>{row.session2_label ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatKuwaitDateTime(row.submitted_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatKuwaitTime(row.shift_end_at)}
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={row.is_active ? "success" : row.is_expired ? "neutral" : "warning"}>
                        {row.is_active
                          ? t("shiftActive")
                          : row.is_expired
                            ? t("shiftExpired")
                            : t("shiftScheduled")}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      {row.shift_adherence && row.shift_adherence.minutes_late > 0
                        ? row.shift_adherence.minutes_late
                        : row.shift_adherence
                          ? "0"
                          : "—"}
                    </TableCell>
                    <TableCell>
                      {row.shift_adherence && row.shift_adherence.minutes_early_out > 0
                        ? row.shift_adherence.minutes_early_out
                        : row.shift_adherence
                          ? "0"
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={row.is_within_window ? "success" : "neutral"}>
                        {row.is_within_window ? t("inWindowYes") : t("inWindowNo")}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={row.is_locked ? "warning" : "neutral"}>
                        {row.is_locked ? t("lockedYes") : t("lockedNo")}
                      </StatusPill>
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
                        {row.is_on_duty ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            render={
                              <Link href={`/live-tracking?driverId=${row.driver_id}`} />
                            }
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
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
    </AppPage>
  );
}
