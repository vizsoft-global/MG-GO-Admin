"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { EmptyCell, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { groupBanner, groupRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
import type { LeavePlanRow } from "@/features/operations-dashboard/shape";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { downloadCsv } from "@/lib/csv/client-download";
import { defaultStartDate, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatPct } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import { leaveExportRows, type LeaveMonthBar } from "@/features/operations-dashboard/shape";
import { fetchClientPortalDashboard } from "./client-portal-actions";
import { ClientPortalNav } from "./client-portal-nav";
import type { ClientPortalDashboard } from "./shape";

type Translator = ReturnType<typeof useTranslations<"pages.clientPortal">>;

const card = "rounded-xl border border-[var(--portal-border)] bg-[var(--portal-canvas)] p-4";

type TodayBarKey = "working" | "onLeave" | "absent" | "sick";

function leaveBarStyle(tense: LeaveMonthBar["tense"]): { backgroundColor: string; border?: string } {
  switch (tense) {
    case "past":
      return { backgroundColor: "var(--portal-badge-blue-fg)" };
    case "current":
      return { backgroundColor: "var(--portal-badge-green-fg)" };
    case "future":
      return {
        backgroundColor: "var(--portal-badge-blue-bg)",
        border: "1px dashed var(--portal-badge-blue-fg)",
      };
    default: {
      const neverTense: never = tense;
      return neverTense;
    }
  }
}

function dailyColor(key: TodayBarKey): string {
  switch (key) {
    case "working":
      return "var(--portal-badge-green-fg)";
    case "onLeave":
      return "var(--portal-badge-blue-fg)";
    case "absent":
      return "var(--portal-badge-red-fg)";
    case "sick":
      return "var(--portal-badge-ochre-fg)";
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function legendColor(key: TodayBarKey): string {
  return dailyColor(key);
}

function dailyLabel(key: TodayBarKey, t: Translator): string {
  switch (key) {
    case "working":
      return t("barWorking");
    case "onLeave":
      return t("barOnLeave");
    case "absent":
      return t("barAbsent");
    case "sick":
      return t("barSick");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function monthTick(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) return yearMonth;
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function projectDisplayName(key: string | undefined, t: Translator): string {
  switch (key) {
    case "keeta":
      return t("projectKeeta");
    case "americana":
      return t("projectAmericana");
    case "unassigned":
      return t("projectUnassigned");
    default:
      return t("title");
  }
}

export function ClientPortalShell({
  preview = null,
  projectKey,
}: {
  preview?: { projectKey: string } | null;
  projectKey?: string;
} = {}) {
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

  const effectiveProjectKey = preview?.projectKey ?? projectKey;
  const projectLabel = projectDisplayName(effectiveProjectKey, t);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchClientPortalDashboard({
      day,
      zoneId: zoneId || undefined,
      projectKey: effectiveProjectKey,
    });
    setDashboard(result.dashboard);
    setFailed(result.failed);
    setLoading(false);
  }, [day, zoneId, effectiveProjectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = dashboard;
  const todayParts = data
    ? (
        [
          { key: "working" as const, count: data.todayBar.working },
          { key: "onLeave" as const, count: data.todayBar.onLeave },
          { key: "absent" as const, count: data.todayBar.absent },
          { key: "sick" as const, count: data.todayBar.sick },
        ] satisfies { key: TodayBarKey; count: number }[]
      ).filter((part) => part.count > 0)
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
  const dateMode = day === today ? "today" : day === yesterday ? "yesterday" : "custom";
  const dateLabel = new Date(`${day}T12:00:00`).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const clock = new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-0 space-y-4 bg-[var(--portal-canvas)] p-3">
      {preview ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--portal-border)] bg-[var(--portal-badge-blue-bg)] px-4 py-2 text-sm text-[var(--portal-ink)]">
          <span>
            Super admin preview — viewing {projectDisplayName(preview.projectKey, t)} client portal.
          </span>
          <Link href="/client-portal/clients" className="font-medium text-[var(--portal-btn)] underline-offset-2 hover:underline">
            Exit preview
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-h1 text-[var(--portal-ink)]">{t("title")}</h1>
          <p className="text-sm text-[var(--portal-muted)]">{t("updatedLine", { date: dateLabel, time: clock })}</p>
        </div>
        <ClientPortalNav projectLabel={projectLabel} previewProjectKey={preview ? effectiveProjectKey : undefined} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-[var(--portal-muted)]">
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
            <SelectTrigger className="h-9 w-40 border-[var(--portal-border)] bg-[var(--portal-canvas)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("today")}</SelectItem>
              <SelectItem value="yesterday">{t("yesterday")}</SelectItem>
              <SelectItem value="custom">{t("pickDate")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs text-[var(--portal-muted)]">
          <span className="sr-only">{t("pickDate")}</span>
          <Input
            className="h-9 w-40 border-[var(--portal-border)] bg-[var(--portal-canvas)]"
            type="date"
            openPickerOnFocus={false}
            value={day}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--portal-muted)]">
          <span className="block">{t("zoneLabel")}</span>
          <Select
            items={zoneItems}
            value={zoneId || "all"}
            onValueChange={(value) => setZoneId(!value || value === "all" ? "" : value)}
          >
            <SelectTrigger className="h-9 w-48 border-[var(--portal-border)] bg-[var(--portal-canvas)]">
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

      {failed ? <ErrorState title={t("loadFailed")} /> : null}
      {loading && !data ? <p className="text-sm text-[var(--portal-muted)]">{t("loading")}</p> : null}

      <section className={card}>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
          {todayParts.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1" style={{ color: legendColor(part.key) }}>
              <span className="size-2.5 rounded-sm" style={{ background: dailyColor(part.key) }} />
              {dailyLabel(part.key, t)} {part.count}
            </span>
          ))}
          <span className="ms-auto text-[var(--portal-ink)]">{t("assignedLine", { count: data?.assignedToYou ?? 0 })}</span>
        </div>
        {todayTotal === 0 ? (
          <EmptyState title={t("todayBarEmpty")} />
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
        <KpiCard layout="portal" portalAccent="plum" label={t("kpiAssigned")} value={data?.kpis.assigned ?? 0} />
        <KpiCard layout="portal" portalAccent="green" label={t("kpiWorking")} value={data?.kpis.working ?? 0} />
        <KpiCard layout="portal" portalAccent="blue" label={t("kpiOnLeave")} value={data?.kpis.onLeave ?? 0} />
        <KpiCard layout="portal" portalAccent="red" label={t("kpiAbsentSick")} value={data?.kpis.absentSick ?? 0} />
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiWorkingRate")}
          value={formatPct(data?.kpis.workingRate ?? 0)}
        />
      </div>

      <section className={card}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--portal-ink)] px-3 py-2 text-[var(--portal-canvas)]">
          <p className="text-sm">{t("leaveChartTitle")}</p>
          <Button
            variant="portal-secondary"
            className="h-9 cursor-pointer border-[var(--portal-canvas)] bg-transparent text-[var(--portal-canvas)] hover:bg-[var(--portal-canvas)]/10"
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
          <EmptyState title={t("leaveChartEmpty")} />
        ) : (
          <div className="flex h-36 items-end gap-1">
            {data?.leaveMonths.map((month) => (
              <button
                key={month.yearMonth}
                type="button"
                className="flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1"
                onClick={() => setLeaveMonth(month.yearMonth)}
              >
                <span className="text-xs text-[var(--portal-muted)]">{month.count}</span>
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(8, Math.round((month.count / maxLeave) * 100))}%`,
                    minHeight: 8,
                    outline:
                      month.yearMonth === selectedLeaveMonth ? "2px solid var(--portal-badge-plum-fg)" : undefined,
                    ...leaveBarStyle(month.tense),
                  }}
                />
                <span className="text-xs text-[var(--portal-muted)]">{monthTick(month.yearMonth, locale)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--portal-muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-[var(--portal-badge-blue-fg)]" />
            {t("legendPast")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-[var(--portal-badge-green-fg)]" />
            {t("legendCurrent")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2.5 rounded-sm border border-dashed border-[var(--portal-badge-blue-fg)] bg-[var(--portal-badge-blue-bg)]"
            />
            {t("legendFuture")}
          </span>
        </div>
        <p className="mb-2 mt-3 text-sm text-[var(--portal-ink)]">{t("planTitle")}</p>
        <PortalLeaveTable
          tableId="clientPortal.leavePlans"
          entity={t("planTitle")}
          rows={monthPlans}
          empty={t("planEmpty")}
          columns={[
            { id: "employeeId", label: t("colEmployeeId"), locked: true },
            { id: "name", label: t("colRider"), locked: true },
            { id: "zone", label: t("colZone"), categorical: true },
            { id: "start", label: t("colLeaveStarts") },
            { id: "end", label: t("colBackOn") },
            { id: "days", label: t("colDays") },
          ]}
        />
        <p className="mt-2 text-xs text-[var(--portal-muted)]">{t("leaveHiddenNote")}</p>
      </section>

      <section className={card}>
        <div className="mb-3 rounded-lg bg-[var(--portal-badge-blue-fg)] px-3 py-2 text-[var(--portal-canvas)]">
          <p className="text-sm">
            {t("onLeaveNowTitle")} ({data?.onLeaveNow.length ?? 0})
          </p>
        </div>
        <PortalLeaveTable
          tableId="clientPortal.onLeaveNow"
          entity={t("onLeaveNowTitle")}
          rows={data?.onLeaveNow ?? []}
          empty={t("onLeaveNowEmpty")}
          soonDay={today}
          columns={[
            { id: "name", label: t("colRider"), locked: true },
            { id: "zone", label: t("colZone"), categorical: true },
            { id: "start", label: t("colSince") },
            { id: "end", label: t("colBackOn") },
          ]}
        />
      </section>
      <p className="text-sm text-[var(--portal-muted)]">{t("contactLine")}</p>
    </div>
  );
}

function PortalLeaveTable({
  tableId,
  entity,
  columns,
  rows,
  empty,
  soonDay,
}: {
  tableId: string;
  entity: string;
  columns: TableToolbarColumn[];
  rows: LeavePlanRow[];
  empty: string;
  soonDay?: string;
}) {
  const signature = columns.map((column) => `${column.id}:${column.label}:${column.categorical ? 1 : 0}:${column.locked ? 1 : 0}`).join("|");
  const stableColumns = useMemo(() => columns, [signature]);
  const prefs = useTablePrefs(tableId, stableColumns);
  const matched = rows.filter((row) =>
    rowMatches(prefs.appliedQuery, [row.employeeId, row.name, row.zone, row.start, row.end, row.days]),
  );
  const groups = groupRows(matched, prefs.groupBy, (row) => (prefs.groupBy === "zone" ? row.zone : ""));
  const ids = visibleColumnIds(prefs);
  return (
    <div>
      <ListToolbar
        prefs={prefs}
        entity={entity}
        columns={stableColumns}
        rowKind="dynamic"
        filteredCount={matched.length}
        totalCount={rows.length}
      />
      {matched.length === 0 ? <EmptyState title={empty} /> : (
        <Table className="text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:h-8">
          <TableHeader>
            <TableRow>
              {ids.map((id) => (
                <TableHead key={id} className={TABLE_HEAD_CLASS}>
                  {stableColumns.find((column) => column.id === id)?.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.label ? (
                  <TableRow>
                    <TableCell colSpan={ids.length} className="bg-muted/40 text-xs font-semibold">
                      {groupBanner(group.label, group.rows.length)}
                    </TableCell>
                  </TableRow>
                ) : null}
                {group.rows.map((row, index) => (
                  <TableRow key={row.id || `${row.employeeId}-${index}`}>
                    {ids.map((id) => (
                      <TableCell
                        key={id}
                        className={id === "end" && soonDay && soon(row.end, soonDay) ? "font-semibold text-[var(--portal-badge-green-fg)]" : undefined}
                      >
                        {id === "name" ? <TableNameCell name={row.name} /> : null}
                        {id === "employeeId" ? (row.employeeId ? row.employeeId : <EmptyCell />) : null}
                        {id === "zone" ? (row.zone ? row.zone : <EmptyCell />) : null}
                        {id === "start" ? (row.start ? row.start : <EmptyCell />) : null}
                        {id === "end" ? (row.end ? row.end : <EmptyCell />) : null}
                        {id === "days" ? (row.days ? row.days : <EmptyCell />) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
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
