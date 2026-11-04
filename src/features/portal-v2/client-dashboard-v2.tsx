"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye, FileText, Info, Mail, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv/client-download";
import { formatKuwaitDateLabel, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";import { formatPct } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import { fetchClientPortalDashboard } from "@/features/client-portal/client-portal-actions";
import type { ClientPortalDashboard, ClientPortalRider } from "@/features/client-portal/shape";
import {
  MonthBars,
  TONE_FILL,
  V2Card,
  V2CardHeader,
  V2Empty,
  V2Note,
  V2Stat,
  V2Surface,
  V2TableShell,
  type MonthBarItem,
} from "@/features/portal-v2/v2-ui";
import { monthLabel, monthLongLabel } from "@/features/operations-dashboard-v2/helpers";
import { fetchPortalExtras, type PortalExtras } from "./portal-v2-actions";
import { PortalV2Nav } from "./portal-v2-nav";
import {
  bucketLabelKey,
  filterRidersByWidget,
  pageSlice,
  pageWindow,
  type RiderWidgetKey,
} from "./portal-rider-widgets";
import { v2WeekdayDate } from "./v2-format";

const HEAD_BTN = "h-9 cursor-pointer";
const SELECT = "h-9 min-h-9 border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]";
const TABLE = "text-[13px] [&_thead_tr]:bg-[var(--surface-subtle)] [&_td]:px-3 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-3";
const TH = "text-start text-[12px] font-medium text-[var(--text-secondary)]";
/** Rows per page in the rider table a KPI card opens. */
const RIDER_PAGE_SIZE = 8;
const SELECTED_KPI = "ring-1 ring-[var(--accent-rust)]";
/** Stable identity for "this read sent no riders", so the filter memo cannot re-run. */
const NO_RIDERS: ClientPortalRider[] = [];

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function docLabel(docType: string): string {
  return docType.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function kuwaitHourNow(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kuwait" }).format(new Date()),
  );
}

/**
 * The status distribution and the KPI cards are two views of the same five
 * buckets, so a legend segment opens the card's table. `sick` and `absent` are
 * separate segments but one card ("Absent / sick" adds them), which is why they
 * map to the same widget rather than to a table of their own.
 */
function widgetForStatusPart(key: string): RiderWidgetKey | null {
  switch (key) {
    case "working":
      return "working";
    case "onLeave":
      return "onLeave";
    case "sick":
    case "absent":
      return "absentSick";
    case "other":
      return "notMarked";
    default:
      return null;
  }
}

/** The card label reused as the drill-down table's heading. */
function widgetTitleKey(widget: RiderWidgetKey): "kpiAssigned" | "kpiWorkingToday" | "kpiOnLeave" | "kpiAbsentSick" | "kpiNotMarked" {
  switch (widget) {
    case "assigned":
      return "kpiAssigned";
    case "working":
      return "kpiWorkingToday";
    case "onLeave":
      return "kpiOnLeave";
    case "absentSick":
      return "kpiAbsentSick";
    case "notMarked":
      return "kpiNotMarked";
    default: {
      const never: never = widget;
      return never;
    }
  }
}

export function ClientDashboardV2({
  preview = null,
  projectKey,
}: {
  preview?: { projectKey: string } | null;
  projectKey?: string;
} = {}) {
  const t = useTranslations("pages.clientPortalV2");
  const tOps = useTranslations("pages.operationsDashboardV2");
  const locale = useLocale();
  const { fullName, email } = useAuth();
  const today = kuwaitTodayYmd();
  const yesterday = addDays(today, -1);
  const effectiveProjectKey = preview?.projectKey ?? projectKey;

  const [day, setDay] = useState(today);
  const [zoneId, setZoneId] = useState("");
  const [leaveMonth, setLeaveMonth] = useState("");
  const [showAllLeave, setShowAllLeave] = useState(false);
  /**
   * The KPI card (or status legend chip) the operator opened, and which page of
   * its rider table is showing. Kept in local state rather than the URL: this is
   * a drill-down inside one dashboard, not a destination.
   */
  const [riderWidget, setRiderWidget] = useState<RiderWidgetKey | null>(null);
  const [riderPage, setRiderPage] = useState(0);
  const [data, setData] = useState<ClientPortalDashboard | null>(null);
  const [extras, setExtras] = useState<PortalExtras>({ onboarding: [], docAlerts: [] });
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchClientPortalDashboard({ day, zoneId: zoneId || undefined, projectKey: effectiveProjectKey }).then(
      (result) => {
        if (cancelled) return;
        setData(result.dashboard);
        setFailed(result.failed);
        setClock(
          new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Kuwait",
          }).format(new Date()),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [day, zoneId, effectiveProjectKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchPortalExtras({ project: effectiveProjectKey }).then((result) => {
      if (!cancelled) setExtras(result);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectKey]);

  const projectLabel = useMemo(() => {
    switch (effectiveProjectKey) {
      case "americana":
        return tOps("projectAmericana");
      case "unassigned":
        return tOps("projectUnassigned");
      default:
        return tOps("projectKeeta");
    }
  }, [effectiveProjectKey, tOps]);

  const zoneItems = useMemo(
    () => [
      { value: "all", label: t("allZones") },
      ...(data?.zones ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
    ],
    [data?.zones, t],
  );

  const bars: MonthBarItem[] = (data?.leaveMonths ?? []).map((month) => ({
    key: month.yearMonth,
    label: monthLabel(month.yearMonth),
    value: month.count,
    tone: month.tense === "current" ? "current" : month.tense === "future" ? "future" : "past",
  }));
  const selectedMonth =
    leaveMonth || data?.leaveMonths.find((month) => month.tense === "current")?.yearMonth || bars[0]?.key || "";
  const selectedBars = bars.map((bar) => ({ ...bar, selected: bar.key === selectedMonth }));
  const monthPlans = (data?.leavePlans ?? []).filter(
    (row) => (row.yearMonth || row.start.slice(0, 7)) === selectedMonth,
  );
  const monthExport = (data?.exportLeaveMonth ?? []).filter((row) => {
    const start = String(row.Start ?? row.start_date ?? "");
    return start.slice(0, 7) === selectedMonth;
  });
  const shownPlans = showAllLeave ? monthPlans : monthPlans.slice(0, 4);

  const todayBar = data?.todayBar;
  const statusParts = [
    { key: "working", label: tOps("kpiWorking"), count: todayBar?.working ?? 0, tone: "working" as const },
    { key: "onLeave", label: tOps("kpiOnLeave"), count: todayBar?.onLeave ?? 0, tone: "leave" as const },
    { key: "sick", label: t("legendSick"), count: todayBar?.sick ?? 0, tone: "sick" as const },
    { key: "absent", label: t("legendAbsent"), count: todayBar?.absent ?? 0, tone: "absent" as const },
    { key: "other", label: tOps("kpiNotMarked"), count: todayBar?.other ?? 0, tone: "neutral" as const },
  ];
  const statusTotal = statusParts.reduce((sum, part) => sum + part.count, 0);

  /**
   * The rider table behind a KPI card.
   *
   * `data.riders` carries the bucket the Cloud Function already computed for
   * each rider, so the rows here are the same population the cards counted —
   * the server fills both in one `classify` pass and they cannot drift. An old
   * function build sends no `riders`; the table then says so instead of silently
   * listing a different set.
   */
  const riderRows = data?.riders ?? NO_RIDERS;
  const drillRows = useMemo(
    () => filterRidersByWidget(riderRows, riderWidget),
    [riderRows, riderWidget],
  );
  const drill = pageSlice(drillRows, riderPage, RIDER_PAGE_SIZE);

  function openRiderWidget(widget: RiderWidgetKey) {
    setRiderWidget((current) => (current === widget ? null : widget));
    setRiderPage(0);
  }

  const away = data?.onLeaveNow ?? [];
  const backThisWeek = away.filter((row) => row.end && row.end <= addDays(today, 7)).length;
  const onboardingThisWeek = extras.onboarding.filter(
    (row) => row.hasStartDate && row.startDate >= today && row.startDate <= addDays(today, 7),
  ).length;
  const onboardingNoDate = extras.onboarding.filter((row) => !row.hasStartDate).length;
  const firstName = (fullName ?? email ?? "—").split(" ")[0] ?? "";
  const hour = kuwaitHourNow();
  const greeting =
    hour < 12
      ? t("goodMorning", { name: firstName })
      : hour < 17
        ? t("goodAfternoon", { name: firstName })
        : t("goodEvening", { name: firstName });
  const dateLabel = v2WeekdayDate(day, locale);

  return (
    <V2Surface>
      {preview ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--selected-navy)] px-4 py-2.5 text-white">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
            <Eye className="size-4 shrink-0" aria-hidden />
            <span className="font-semibold">{t("previewModeTitle")}</span>
            <span className="text-white/75">{t("previewModeBody", { client: projectLabel })}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs text-white/80">
              {t("viewingAs")}
              <span className="font-semibold text-white">{projectLabel}</span>
              <ChevronDown className="size-3.5" aria-hidden />
            </span>
            <Link
              href="/client-portal-v2/clients"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/40 px-2.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-white/10"
            >
              <X className="size-3.5" aria-hidden />
              {t("exitPreview")}
            </Link>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]">
        <PortalV2Nav
          projectLabel={projectLabel}
          previewProjectKey={preview ? effectiveProjectKey : undefined}
          updatedAt={clock}
        />
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] font-bold leading-9 text-[var(--text-primary)]">{greeting}</h1>
            <p className="text-sm text-[var(--text-secondary)]">{t("dashboardSubtitle", { date: dateLabel })}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span className="block">{t("zoneLabel")}</span>
              <Select
                items={zoneItems}
                value={zoneId || "all"}
                onValueChange={(value) => setZoneId(!value || value === "all" ? "" : value)}
              >
                <SelectTrigger className={`${SELECT} w-40`} aria-label={t("zoneLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zoneItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span className="block">{t("periodLabel")}</span>
              <Select
                items={selectOptions([
                  { value: "today", label: t("today") },
                  { value: "yesterday", label: t("yesterday") },
                ])}
                value={day === today ? "today" : "yesterday"}
                onValueChange={(value) => setDay(value === "yesterday" ? yesterday : today)}
              >
                <SelectTrigger className={`${SELECT} w-36`} aria-label={t("periodLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{t("today")}</SelectItem>
                  <SelectItem value="yesterday">{t("yesterday")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button
              variant="portal-secondary"
              className={HEAD_BTN}
              disabled={!data}
              onClick={() =>
                downloadCsv(
                  `riders-${day}.csv`,
                  ["Employee ID", "Name", "Status", "Zone"],
                  (data?.exportRiders ?? []).map((row) => [
                    String(row["Employee ID"] ?? ""),
                    String(row.Name ?? ""),
                    String(row.Status ?? ""),
                    String(row.Zone ?? ""),
                  ]),
                )
              }
            >
              <Download className="size-4" aria-hidden />
              {t("exportExcel")}
            </Button>
          </div>
        </div>
      </div>

      {failed ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--status-absent-bg)] px-3 py-2 text-sm text-[var(--status-absent-fg)]">
          <Info className="size-4" aria-hidden />
          {t("loadFailed")}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          layout="portal"
          portalAccent="ink"
          label={t("kpiAssigned")}
          value={data?.kpis.assigned ?? 0}
          caption={t("captionContracted", { count: "—" })}
          onClick={() => openRiderWidget("assigned")}
          className={riderWidget === "assigned" ? SELECTED_KPI : undefined}
        />
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiWorkingToday")}
          value={data?.kpis.working ?? 0}
          caption={t("captionWorkingRate", { pct: formatPct(data?.kpis.workingRate ?? 0) })}
          onClick={() => openRiderWidget("working")}
          className={riderWidget === "working" ? SELECTED_KPI : undefined}
        />
        <KpiCard
          layout="portal"
          portalAccent="blue"
          label={t("kpiOnLeave")}
          value={data?.kpis.onLeave ?? 0}
          caption={t("captionBackThisWeek", { count: backThisWeek })}
          onClick={() => openRiderWidget("onLeave")}
          className={riderWidget === "onLeave" ? SELECTED_KPI : undefined}
        />
        <KpiCard
          layout="portal"
          portalAccent="red"
          label={t("kpiAbsentSick")}
          value={data?.kpis.absentSick ?? 0}
          caption={t("captionAbsentSick", { absent: todayBar?.absent ?? 0, sick: todayBar?.sick ?? 0 })}
          onClick={() => openRiderWidget("absentSick")}
          className={riderWidget === "absentSick" ? SELECTED_KPI : undefined}
        />
        <KpiCard
          layout="portal"
          portalAccent="grey"
          label={t("kpiNotMarked")}
          value={todayBar?.other ?? 0}
          caption={t("captionAttendancePending")}
          onClick={() => openRiderWidget("notMarked")}
          className={riderWidget === "notMarked" ? SELECTED_KPI : undefined}
        />
        {/* Contracted count is not recorded anywhere yet, so this card opens
            nothing rather than opening an empty table and implying it has rows. */}
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiContractFill")}
          value="—"
          caption={t("contractNotSet")}
        />
      </div>

      <V2Card className="mt-3 p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[17px] font-bold leading-6 text-[var(--text-primary)]">{t("statusTitle")}</h2>
          <p className="text-xs text-[var(--text-secondary)]">{t("ridersCount", { count: statusTotal })}</p>
        </div>
        {statusTotal === 0 ? (
          <V2Empty>{t("loadFailed")}</V2Empty>
        ) : (
          <>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
              {statusParts.map((part) => (
                <div
                  key={part.key}
                  className={TONE_FILL[part.tone]}
                  style={{ width: `${(part.count / statusTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-secondary)]">
              {statusParts.map((part) => {
                const widget = widgetForStatusPart(part.key);
                const active = widget != null && riderWidget === widget;
                return (
                  <button
                    key={part.key}
                    type="button"
                    // The legend is the same five buckets as the cards, so it
                    // drives the same table. `sick` and `absent` both open
                    // "Absent / sick", which is the card that counts them.
                    onClick={widget ? () => openRiderWidget(widget) : undefined}
                    disabled={!widget}
                    aria-pressed={widget ? active : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors duration-150 motion-reduce:transition-none ${
                      widget ? "cursor-pointer hover:bg-[var(--surface-subtle)]" : ""
                    } ${active ? "bg-[var(--surface-subtle)] font-semibold text-[var(--text-primary)]" : ""}`}
                  >
                    <span className={`size-2 rounded-full ${TONE_FILL[part.tone]}`} aria-hidden />
                    {part.label}
                    <span className="font-semibold text-[var(--text-primary)]">{part.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </V2Card>

      {riderWidget ? (
        <V2Card className="mt-3 p-4 xl:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-bold leading-6 text-[var(--text-primary)]">
                {t(widgetTitleKey(riderWidget))}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {t("ridersCount", { count: drillRows.length })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="portal-secondary"
                className={HEAD_BTN}
                disabled={drillRows.length === 0}
                onClick={() =>
                  downloadCsv(
                    `riders-${riderWidget}-${day}.csv`,
                    [t("colEmployee"), t("colRider"), t("colZone"), t("colBucket"), t("colStatus")],
                    drillRows.map((row) => [
                      row.employeeId,
                      row.name,
                      row.zone || "—",
                      t(bucketLabelKey(row.bucket)),
                      row.status,
                    ]),
                  )
                }
              >
                <Download className="size-4" aria-hidden />
                {t("exportExcel")}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setRiderWidget(null);
                  setRiderPage(0);
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-subtle)] motion-reduce:transition-none"
              >
                <X className="size-3.5" aria-hidden />
                {t("clearWidget")}
              </button>
            </div>
          </div>

          <V2TableShell className="mt-3">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colEmployee")}</TableHead>
                  <TableHead className={TH}>{t("colRider")}</TableHead>
                  <TableHead className={TH}>{t("colZone")}</TableHead>
                  <TableHead className={TH}>{t("colBucket")}</TableHead>
                  <TableHead className={TH}>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drill.slice.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-[var(--text-secondary)]">
                      {riderRows.length === 0 ? t("ridersUnavailable") : t("widgetEmpty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  drill.slice.map((row) => (
                    <TableRow key={`${row.employeeId}-${row.name}`}>
                      <TableCell className="tabular-nums">{row.employeeId || "—"}</TableCell>
                      <TableCell className="font-medium">{row.name || "—"}</TableCell>
                      <TableCell>{row.zone || "—"}</TableCell>
                      <TableCell>{t(bucketLabelKey(row.bucket))}</TableCell>
                      <TableCell className="text-[var(--text-secondary)]">{row.status || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </V2TableShell>

          {drill.pageCount > 1 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
              <span>
                {t("pagerRange", { from: drill.from, to: drill.to, total: drillRows.length })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={drill.page === 0}
                  onClick={() => setRiderPage(drill.page - 1)}
                  className="inline-flex h-7 items-center rounded-md border border-[var(--border-default)] px-2 font-medium text-[var(--text-primary)] disabled:opacity-40"
                >
                  {t("pagerPrev")}
                </button>
                {pageWindow(drill.page, drill.pageCount).map((index, position) =>
                  index == null ? (
                    <span key={`gap-${position}`} className="px-1">
                      …
                    </span>
                  ) : (
                    <button
                      key={index}
                      type="button"
                      aria-current={index === drill.page ? "page" : undefined}
                      onClick={() => setRiderPage(index)}
                      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 tabular-nums ${
                        index === drill.page
                          ? "border-[var(--accent-rust)] bg-[var(--accent-rust)] font-semibold text-white"
                          : "border-[var(--border-default)] text-[var(--text-primary)]"
                      }`}
                    >
                      {index + 1}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={drill.page >= drill.pageCount - 1}
                  onClick={() => setRiderPage(drill.page + 1)}
                  className="inline-flex h-7 items-center rounded-md border border-[var(--border-default)] px-2 font-medium text-[var(--text-primary)] disabled:opacity-40"
                >
                  {t("pagerNext")}
                </button>
              </div>
            </div>
          ) : null}
        </V2Card>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <V2Card className="p-4 xl:p-5 lg:col-span-2">
          <V2CardHeader
            title={t("leavePlanTitle")}
            subtitle={t("leavePlanSubtitle")}
            actions={
              <Select
                items={selectOptions([{ value: today.slice(0, 4), label: today.slice(0, 4) }])}
                value={today.slice(0, 4)}
                disabled
              >
                <SelectTrigger className={`${SELECT} w-24`} aria-label={t("leavePlanTitle")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={today.slice(0, 4)}>{today.slice(0, 4)}</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <div className="mt-5">
            {bars.length === 0 ? (
              <V2Empty>{t("loadFailed")}</V2Empty>
            ) : (
              <MonthBars items={selectedBars} height={170} onSelect={setLeaveMonth} />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] bg-[var(--selected-navy)]" aria-hidden />
              {t("legendTaken")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] bg-[var(--accent-rust)]" aria-hidden />
              {t("legendCurrent")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] border border-dashed border-[var(--text-muted)]" aria-hidden />
              {t("legendApproved")}
            </span>
          </div>

          <div className="mt-4 rounded-xl bg-[var(--surface-subtle)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[15px] font-bold leading-6 text-[var(--text-primary)]">
                  {selectedMonth ? monthLongLabel(selectedMonth) : "—"}
                </p>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  {t("selectedMonthSubtitle", {
                    count: monthPlans.filter((row) => row.status === "approved").length || monthPlans.length,
                    client: projectLabel,
                  })}
                </p>
              </div>
              <Button
                variant="portal-secondary"
                className={HEAD_BTN}
                disabled={monthExport.length === 0}
                onClick={() =>
                  downloadCsv(
                    `leave-${selectedMonth}.csv`,
                    ["Employee ID", "Name", "Project", "Leave Type", "Start", "End", "Days", "Status"],
                    monthExport.map((row) => [
                      String(row["Employee ID"] ?? ""),
                      String(row.Name ?? ""),
                      String(row.Project ?? ""),
                      String(row["Leave Type"] ?? ""),
                      String(row.Start ?? ""),
                      String(row.End ?? ""),
                      String(row.Days ?? ""),
                      String(row.Status ?? ""),
                    ]),
                  )
                }
              >
                <Download className="size-4" aria-hidden />
                {t("exportMonth", { month: selectedMonth ? monthLabel(selectedMonth) : "" })}
              </Button>
            </div>
            <V2TableShell className="mt-3">
              <Table className={TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>{t("colRiderId")}</TableHead>
                    <TableHead className={TH}>{t("colRider")}</TableHead>
                    <TableHead className={TH}>{t("colZone")}</TableHead>
                    <TableHead className={TH}>{t("colLeaveStarts")}</TableHead>
                    <TableHead className={TH}>{t("colBackOn")}</TableHead>
                    <TableHead className={`${TH} text-center`}>{t("colDays")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownPlans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-[var(--text-secondary)]">
                        {t("loadFailed")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    shownPlans.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="tabular-nums">{row.employeeId}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.zone || "—"}</TableCell>
                        <TableCell className="tabular-nums">{formatKuwaitDateLabel(row.start)}</TableCell>
                        <TableCell className="tabular-nums">{formatKuwaitDateLabel(row.end)}</TableCell>
                        <TableCell className="text-center tabular-nums">{row.days}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </V2TableShell>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--text-secondary)]">
                {t("showingNote", { shown: shownPlans.length, total: monthPlans.length })}
              </p>
              {monthPlans.length > 4 ? (
                <button
                  type="button"
                  onClick={() => setShowAllLeave((open) => !open)}
                  className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-[var(--accent-rust)]"
                >
                  {t("viewAllCount", { count: monthPlans.length })}
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </V2Card>

        <V2Card className="p-4 xl:p-5">
          <V2CardHeader title={t("newRidersTitle")} subtitle={t("newRidersSubtitle", { client: projectLabel })} />
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <V2Stat tone="working" label={t("onboarding")} value={extras.onboarding.length} />
            <V2Stat tone="working" label={t("thisWeek")} value={onboardingThisWeek} />
            <V2Stat tone="sick" label={t("noDate")} value={onboardingNoDate} />
          </div>
          <ul className="mt-4 divide-y divide-[var(--border-default)]">
            {extras.onboarding.length === 0 ? (
              <li>
                <V2Empty>{t("noOnboarding")}</V2Empty>
              </li>
            ) : (
              extras.onboarding.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{row.name}</p>
                    <span
                      className={
                        row.hasStartDate && row.startDate <= addDays(today, 7)
                          ? "mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--status-working-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-working-fg)]"
                          : "mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                      }
                    >
                      <span
                        className={
                          row.hasStartDate && row.startDate <= addDays(today, 7)
                            ? "size-1.5 rounded-full bg-[var(--status-working-fg)]"
                            : "size-1.5 rounded-full bg-[var(--status-neutral-fg)]"
                        }
                        aria-hidden
                      />
                      {row.hasStartDate && row.startDate <= addDays(today, 7) ? t("thisWeek") : t("onboarding")}
                    </span>
                  </div>
                  <p className="shrink-0 text-right text-[12px] text-[var(--text-secondary)]">
                    {row.hasStartDate
                      ? t("startsOn", { date: formatKuwaitDateLabel(row.startDate) })
                      : t("noStartDate")}
                  </p>
                </li>
              ))
            )}
          </ul>
          <div className="mt-3">
            <V2Note>{t("startDatesNote")}</V2Note>
          </div>
        </V2Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <V2Card className="p-4 xl:p-5 lg:col-span-2">
          <V2CardHeader
            title={t("onLeaveNowTitle")}
            subtitle={t("onLeaveNowSubtitle", { count: away.length, client: projectLabel })}
          />
          <V2TableShell className="mt-3">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colRider")}</TableHead>
                  <TableHead className={TH}>{t("colZone")}</TableHead>
                  <TableHead className={TH}>{t("colSince")}</TableHead>
                  <TableHead className={TH}>{t("colBackOn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {away.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-[var(--text-secondary)]">
                      {t("loadFailed")}
                    </TableCell>
                  </TableRow>
                ) : (
                  away.slice(0, 5).map((row, index) => {
                    const pill = backPill(row.end, today, t("badgeToday"));
                    return (
                      <TableRow key={`${row.employeeId}-${index}`}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.zone || "—"}</TableCell>
                        <TableCell className="tabular-nums">{formatKuwaitDateLabel(row.start)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${pill.className}`}>
                            <span className={`size-1.5 rounded-full ${pill.dot}`} aria-hidden />
                            {pill.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </V2TableShell>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--status-working-fg)]" aria-hidden />
              {t("legendBackWithin3")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--status-leave-fg)]" aria-hidden />
              {t("legendLater")}
            </span>
          </div>
        </V2Card>

        <V2Card className="p-4 xl:p-5">
          <V2CardHeader title={t("docAttentionTitle")} subtitle={t("docAttentionSubtitle")} />
          <ul className="mt-3 divide-y divide-[var(--border-default)]">
            {extras.docAlerts.length === 0 ? (
              <li>
                <V2Empty>{t("noDocAlerts")}</V2Empty>
              </li>
            ) : (
              extras.docAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-subtle)]">
                    <FileText className="size-4 text-[var(--text-secondary)]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{alert.name}</p>
                    <p className="truncate text-[12px] text-[var(--text-secondary)]">
                      {alert.expired
                        ? t("docExpiredLine", { type: docLabel(alert.docType), date: formatKuwaitDateLabel(alert.expiresAt) })
                        : t("docLine", { type: docLabel(alert.docType), date: formatKuwaitDateLabel(alert.expiresAt) })}
                    </p>
                  </div>
                  <span
                    className={
                      alert.expired
                        ? "shrink-0 rounded-full bg-[var(--status-absent-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-absent-fg)]"
                        : "shrink-0 rounded-full bg-[var(--status-sick-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-sick-fg)]"
                    }
                  >
                    {alert.expired ? t("docExpired") : t("docExpiring")}
                  </span>
                </li>
              ))
            )}
          </ul>
          <Link
            href={
              preview
                ? `/client-portal-v2/employees?project=${effectiveProjectKey}`
                : "/client-portal-v2/employees"
            }
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent-rust)]"
          >
            {t("openInEmployees")}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </V2Card>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-subtle)]">
            <Mail className="size-4 text-[var(--text-secondary)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{t("supportTitle")}</p>
            <p className="text-xs text-[var(--text-secondary)]">{t("supportLineGeneric")}</p>
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{t("viewOnly")}</p>
      </footer>
    </V2Surface>
  );
}

function backPill(end: string, today: string, todayLabel: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return {
      label: "—",
      className: "bg-[var(--status-neutral-bg)] text-[var(--text-secondary)]",
      dot: "bg-[var(--status-neutral-fg)]",
    };
  }
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 3) {
    return {
      label: days <= 0 ? todayLabel : formatKuwaitDateLabel(end),
      className: "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]",
      dot: "bg-[var(--status-working-fg)]",
    };
  }
  return {
    label: formatKuwaitDateLabel(end),
    className: "bg-[var(--status-leave-bg)] text-[var(--status-leave-fg)]",
    dot: "bg-[var(--status-leave-fg)]",
  };
}


