"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppPage } from "@/components/app/app-page";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { downloadCsv } from "@/lib/csv/client-download";
import { defaultStartDate, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatPct } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import { leaveExportRows, type LeaveMonthBar } from "@/features/operations-dashboard/shape";
import { fetchClientPortalDashboard } from "./client-portal-actions";
import { ClientPortalNav } from "./client-portal-nav";
import {
  riderExportRows,
  turnoverExportRows,
  type ClientPortalDashboard,
  type RiderStatusKey,
} from "./shape";

type Translator = ReturnType<typeof useTranslations<"pages.clientPortal">>;

function leaveBarStyle(tense: LeaveMonthBar["tense"]): { backgroundColor: string; border?: string } {
  switch (tense) {
    case "past":
      return { backgroundColor: "#1565c0" };
    case "current":
      return { backgroundColor: "#0f6e78" };
    case "future":
      return { backgroundColor: "#dbe7f7", border: "1px dashed #1565c0" };
    default: {
      const neverTense: never = tense;
      return neverTense;
    }
  }
}

function statusColor(key: RiderStatusKey): string {
  switch (key) {
    case "running":
      return "#1e7e34";
    case "extension":
      return "#0d7a5f";
    case "leave":
      return "#1565c0";
    case "new":
      return "#00838f";
    case "cancelled":
      return "#5c6370";
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function statusLabel(key: RiderStatusKey, t: Translator): string {
  switch (key) {
    case "running":
      return t("statusRunning");
    case "extension":
      return t("statusExtension");
    case "leave":
      return t("statusLeave");
    case "new":
      return t("statusNew");
    case "cancelled":
      return t("statusCancelled");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function dailyColor(key: string): string {
  switch (key) {
    case "working":
      return "#22863a";
    case "onLeave":
      return "#1565c0";
    case "absent":
      return "#c62828";
    case "sick":
      return "#e8710a";
    case "other":
      return "#9aa1ab";
    default:
      return "#5c6370";
  }
}

function legendColor(key: string): string {
  switch (key) {
    case "working":
      return "#1e7e34";
    case "onLeave":
      return "#1565c0";
    case "absent":
      return "#b71c1c";
    case "sick":
      return "#b45309";
    case "other":
      return "#5c6370";
    default:
      return "#5c6370";
  }
}

function dailyLabel(key: string, t: Translator): string {
  switch (key) {
    case "working":
      return t("barWorking");
    case "onLeave":
      return t("barOnLeave");
    case "absent":
      return t("barAbsent");
    case "sick":
      return t("barSick");
    case "other":
      return t("barOther");
    default:
      return key;
  }
}

function monthTick(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) return yearMonth;
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

export function ClientPortalShell() {
  const t = useTranslations("pages.clientPortal");
  const locale = useLocale();
  const today = kuwaitTodayYmd();
  const yesterday = defaultStartDate(1);
  const [day, setDay] = useState(today);
  const [zoneId, setZoneId] = useState("");
  const [leaveMonth, setLeaveMonth] = useState("");
  const [dashboard, setDashboard] = useState<ClientPortalDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchClientPortalDashboard({ day, zoneId: zoneId || undefined });
    setDashboard(result.dashboard);
    setFailed(result.failed);
    setLoading(false);
  }, [day, zoneId]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = dashboard;
  const todayParts = data
    ? [
        { key: "working", count: data.todayBar.working },
        { key: "onLeave", count: data.todayBar.onLeave },
        { key: "absent", count: data.todayBar.absent },
        { key: "sick", count: data.todayBar.sick },
        { key: "other", count: data.todayBar.other },
      ]
    : [];
  const todayTotal = todayParts.reduce((sum, part) => sum + part.count, 0);
  const zoneItems = selectOptions([
    { value: "all", label: t("zoneAll") },
    ...(data?.zones ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
  ]);
  const maxLeave = Math.max(1, ...(data?.leaveMonths ?? []).map((month) => month.count));
  const selectedLeaveMonth =
    leaveMonth || data?.leaveMonths.find((month) => month.tense === "current")?.yearMonth || "";
  const monthPlans = useMemo(
    () =>
      (data?.leavePlans ?? []).filter(
        (row) => (row.yearMonth || row.start.slice(0, 7)) === selectedLeaveMonth,
      ),
    [data?.leavePlans, selectedLeaveMonth],
  );
  const comparison = data?.turnoverComparison;
  const shownMonths = (comparison?.months ?? []).filter((row) => row.yearMonth <= today.slice(0, 7));
  const peakRow =
    shownMonths.length > 0
      ? shownMonths.reduce((best, row) => (row.rate > best.rate ? row : best))
      : undefined;
  const peakLabel = peakRow && peakRow.rate > 0 ? `${monthTick(peakRow.yearMonth, locale)} · ${formatPct(peakRow.rate)}` : "—";
  const dateMode = day === today ? "today" : day === yesterday ? "yesterday" : "custom";
  const dateLabel = new Date(`${day}T12:00:00`).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const clock = new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const statusTotal = (data?.riderStatus ?? []).reduce((sum, card) => sum + card.count, 0);
  const card = "rounded-xl border bg-white p-4";

  return (
    <AppPage className="space-y-6 bg-[#f4f5f7]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-h1 text-[#1f2328]">{t("title")}</h1>
          <p className="text-sm text-[#5c6370]">{t("updatedLine", { date: dateLabel, time: clock })}</p>
        </div>
        <ClientPortalNav />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">
          <span className="block">{t("pickDate")}</span>
          <Select
            items={selectOptions([
              { value: "today", label: t("today") },
              { value: "yesterday", label: t("yesterday") },
              { value: "custom", label: t("pickDate") },
            ])}
            value={dateMode}
            onValueChange={(value) => {
              if (value === "today") setDay(today);
              if (value === "yesterday") setDay(yesterday);
            }}
          >
            <SelectTrigger className="h-9 w-40 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("today")}</SelectItem>
              <SelectItem value="yesterday">{t("yesterday")}</SelectItem>
              <SelectItem value="custom">{t("pickDate")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="sr-only">{t("pickDate")}</span>
          <Input
            className="h-9 w-40 bg-white"
            type="date"
            openPickerOnFocus={false}
            value={day}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block">{t("zoneLabel")}</span>
          <Select
            items={zoneItems}
            value={zoneId || "all"}
            onValueChange={(value) => setZoneId(!value || value === "all" ? "" : value)}
          >
            <SelectTrigger className="h-9 w-48 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zoneItems.map((item) => (
                <SelectItem key={item.value || "all"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {failed ? <p className="text-sm text-destructive">{t("loadFailed")}</p> : null}
      {loading && !data ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
          {todayParts.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1" style={{ color: legendColor(part.key) }}>
              <span className="size-2.5 rounded-sm" style={{ background: dailyColor(part.key) }} />
              {dailyLabel(part.key, t)} {part.count}
            </span>
          ))}
          <span className="ms-auto text-[#1f2328]">{t("assignedLine", { count: data?.assignedToYou ?? 0 })}</span>
        </div>
        {todayTotal === 0 ? (
          <p className="text-sm text-[#5c6370]">{t("todayBarEmpty")}</p>
        ) : (
          <div className="flex h-4 overflow-hidden rounded-md">
            {todayParts.map((part) => (
              <div
                key={part.key}
                style={{ backgroundColor: dailyColor(part.key), width: `${(part.count / todayTotal) * 100}%` }}
                title={`${dailyLabel(part.key, t)} ${part.count}`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Tile label={t("kpiAssigned")} value={data?.kpis.assigned ?? 0} color="#714b67" />
        <Tile label={t("kpiWorking")} value={data?.kpis.working ?? 0} color="#22863a" valueColor="#1e7e34" />
        <Tile label={t("kpiOnLeave")} value={data?.kpis.onLeave ?? 0} color="#1565c0" />
        <Tile label={t("kpiAbsentSick")} value={data?.kpis.absentSick ?? 0} color="#c62828" valueColor="#b71c1c" />
        <Tile label={t("kpiWorkingRate")} value={formatPct(data?.kpis.workingRate ?? 0)} color="#0f6e78" />
      </div>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#714b67" }}>
          <p className="text-sm uppercase">{t("riderStatusTitle")}</p>
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() =>
              downloadCsv(
                "riders.csv",
                ["Employee ID", "Name", "Status", "Zone"],
                riderExportRows(data?.exportRiders ?? []),
              )
            }
          >
            {t("exportRiders")}
          </Button>
        </div>
        {(data?.riderStatus.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("riderStatusEmpty")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(data?.riderStatus ?? []).map((card) => (
              <div key={card.key} className="rounded-lg border border-border p-3">
                <p className="text-xs" style={{ color: statusColor(card.key) }}>
                  {statusLabel(card.key, t)}
                </p>
                <p className="text-base tabular-nums">{card.count}</p>
                <p className="text-xs text-[#5c6370]">{t("ofYourRiders", { pct: statusTotal === 0 ? 0 : Math.round((card.count / statusTotal) * 100) })}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#0f6e78" }}>
          <p className="text-sm uppercase">{t("leaveChartTitle")}</p>
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() =>
              downloadCsv(
                "leave-month.csv",
                ["Employee ID", "Name", "Project", "Leave Type", "Start", "End", "Days", "Status"],
                leaveExportRows(data?.exportLeaveMonth ?? []),
              )
            }
          >
            {t("exportMonth")}
          </Button>
        </div>
        {(data?.leaveMonths.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leaveChartEmpty")}</p>
        ) : (
          <div className="flex h-36 items-end gap-1">
            {data?.leaveMonths.map((month) => (
              <button
                key={month.yearMonth}
                type="button"
                className="flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1"
                onClick={() => setLeaveMonth(month.yearMonth)}
              >
                <span className="text-xs text-muted-foreground">{month.count}</span>
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(8, Math.round((month.count / maxLeave) * 100))}%`,
                    minHeight: 8,
                    outline: month.yearMonth === selectedLeaveMonth ? "2px solid #714b67" : undefined,
                    ...leaveBarStyle(month.tense),
                  }}
                />
                <span className="text-xs text-muted-foreground">{monthTick(month.yearMonth, locale)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#5c6370]">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "#1565c0" }} />{t("legendPast")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "#0f6e78" }} />{t("legendCurrent")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm border border-dashed" style={{ background: "#dbe7f7", borderColor: "#1565c0" }} />{t("legendFuture")}</span>
        </div>
        <p className="mb-2 mt-3 text-sm text-[#1f2328]">{t("planTitle")}</p>
        {monthPlans.length === 0 ? (
          <p className="text-sm text-[#5c6370]">{t("planEmpty")}</p>
        ) : (
          <Table className="text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colRider")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colLeaveStarts")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colBackOn")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDays")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthPlans.map((row, index) => (
                <TableRow key={row.id || `${row.employeeId}-${index}`}>
                  <TableCell>{row.employeeId || "—"}</TableCell>
                  <TableCell>{row.name || "—"}</TableCell>
                  <TableCell>{row.zone || "—"}</TableCell>
                  <TableCell>{row.start || "—"}</TableCell>
                  <TableCell>{row.end || "—"}</TableCell>
                  <TableCell>{row.days || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-[#5c6370]">{t("leaveHiddenNote")}</p>
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#b45309" }}>
          <p className="text-sm uppercase">{t("turnoverTitle")}</p>
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() =>
              downloadCsv(
                "turnover.csv",
                [t("colMonth"), t("colAvg"), t("colLeft"), t("colRate")],
                turnoverExportRows(data?.exportTurnover ?? []),
              )
            }
          >
            {t("exportTurnover")}
          </Button>
        </div>
        {!data?.turnover.monthly && !data?.turnover.yearly ? (
          <p className="text-sm text-muted-foreground">{t("turnoverEmpty")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("turnoverThisYear")} value={comparison ? formatPct(comparison.annualPct) : data?.turnover.yearly || "—"} color="#b45309" />
            <Tile label={t("turnoverMonthlyAvg")} value={comparison ? formatPct(comparison.monthlyAvgPct) : "—"} color="#714b67" />
            <Tile label={t("turnoverDepartures")} value={comparison?.departuresCount ?? "—"} color="#c62828" />
            <Tile label={t("turnoverHighest")} value={peakLabel} color="#b45309" />
          </div>
        )}
        {shownMonths.length === 0 ? null : (
          <>
            <div className="mt-3 flex h-28 items-end gap-1">
              {shownMonths.map((row) => {
                const maxRate = Math.max(1, ...shownMonths.map((item) => item.rate));
                const current = row.yearMonth === today.slice(0, 7);
                return (
                  <div key={row.yearMonth} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-[#5c6370]">{formatPct(row.rate)}</span>
                    <span
                      className="w-full rounded-sm"
                      style={{
                        height: `${Math.max(8, Math.round((row.rate / maxRate) * 100))}%`,
                        background: current ? "#fdf0e3" : "#b45309",
                        border: current ? "1px dashed #b45309" : undefined,
                      }}
                    />
                    <span className="text-[10px] text-[#5c6370]">{current ? `*${monthTick(row.yearMonth, locale)}` : monthTick(row.yearMonth, locale)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table className="text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:h-8">
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS} />
                    {shownMonths.map((row) => (
                      <TableHead key={row.yearMonth} className={TABLE_HEAD_CLASS}>{monthTick(row.yearMonth, locale)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>{t("colAvg")}</TableCell>
                    {shownMonths.map((row) => <TableCell key={row.yearMonth}>{row.avgActive}</TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell>{t("colLeft")}</TableCell>
                    {shownMonths.map((row) => <TableCell key={row.yearMonth}>{row.departures}</TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell>{t("colRate")}</TableCell>
                    {shownMonths.map((row) => <TableCell key={row.yearMonth}>{formatPct(row.rate)}</TableCell>)}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {data?.turnover.footnote || t("turnoverFootnote")}
        </p>
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 rounded-lg px-3 py-2 text-white" style={{ background: "#1565c0" }}>
          <p className="text-sm uppercase">
            {t("onLeaveNowTitle")} ({data?.onLeaveNow.length ?? 0})
          </p>
        </div>
        {(data?.onLeaveNow.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("onLeaveNowEmpty")}</p>
        ) : (
          <Table className="text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colRider")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colSince")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colBackOn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.onLeaveNow.map((row, index) => (
                <TableRow key={row.id || `${row.employeeId}-${index}`}>
                  <TableCell>{row.name || "—"}</TableCell>
                  <TableCell>{row.zone || "—"}</TableCell>
                  <TableCell>{row.start || "—"}</TableCell>
                  <TableCell style={soon(row.end, today) ? { color: "#1e7e34", fontWeight: 600 } : undefined}>{row.end || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <p className="text-sm text-[#5c6370]">{t("contactLine")}</p>
    </AppPage>
  );
}

function soon(end: string, today: string): boolean {
  if (!end) return false;
  const endMs = Date.parse(`${end.slice(0, 10)}T12:00:00`);
  const todayMs = Date.parse(`${today}T12:00:00`);
  if (!Number.isFinite(endMs) || !Number.isFinite(todayMs)) return false;
  const diff = (endMs - todayMs) / 86_400_000;
  return diff >= 0 && diff <= 3;
}

function Tile({ label, value, color, valueColor }: { label: string; value: string | number; color: string; valueColor?: string }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2" style={{ borderColor: "#e3e5e8", borderTop: `3px solid ${color}` }}>
      <p className="text-xl tabular-nums" style={{ color: valueColor ?? color }}>{value}</p>
      <p className="type-caption mt-1 uppercase tracking-wide text-[#5c6370]">{label}</p>
    </div>
  );
}
