"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Download, RefreshCw, Trash2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/csv/client-download";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { formatPct, roundPercent } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  deleteLeavePlan,
  fetchOperationsDashboard,
  importLeavePlans,
  setLeavePlanStatus,
  upsertLeavePlan,
} from "./operations-dashboard-actions";
import {
  filterRoster,
  jobEndExportRows,
  leaveExportRows,
  periodBounds,
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type EmployeeStatusKey,
  type JobEndCardKey,
  type LeaveMonthBar,
  type LeavePlanRow,
  type OperationsDashboard,
  type OutlookFilter,
  type OutlookKey,
  type ProjectRow,
  type RosterFilter,
  type RosterRow,
  type PlainRow,
} from "./shape";

const PLAN_STATUSES = ["pending", "approved", "taken", "rejected"] as const;
const LEAVE_TYPES = ["annual", "emergency", "sick", "unpaid"] as const;
const HEADER_BTN = "h-9 cursor-pointer px-3";
const PILL = "h-9 cursor-pointer rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--btn-focus)] disabled:opacity-[var(--btn-disabled-opacity)]";
const DENSE_TABLE = "text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:h-8";

type Translator = ReturnType<typeof useTranslations<"pages.operationsDashboard">>;

function employeeColor(key: EmployeeStatusKey): string {
  switch (key) {
    case "running":
      return "#1e7e34";
    case "extension":
      return "#0d7a5f";
    case "leave":
      return "#1565c0";
    case "new":
      return "#00838f";
    case "absentFromMosal":
      return "#c2185b";
    case "cancelled":
      return "#5c6370";
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
    case "accident":
      return "#714b67";
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

type JobWindow = "next6" | "next12" | "past6";
type MatrixRow = { key: string; label: string; cells: number[]; total: number };

function jobWindowSpan(window: JobWindow): { start: number; count: number } {
  switch (window) {
    case "next6":
      return { start: 0, count: 6 };
    case "next12":
      return { start: 0, count: 12 };
    case "past6":
      return { start: -6, count: 6 };
    default: {
      const neverWindow: never = window;
      return neverWindow;
    }
  }
}

function jobWindowMonths(today: string, window: JobWindow): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const span = jobWindowSpan(window);
  const months: string[] = [];
  for (let index = 0; index < span.count; index += 1) {
    const cursor = year * 12 + (month - 1) + span.start + index;
    const nextYear = Math.floor(cursor / 12);
    const nextMonth = (cursor % 12) + 1;
    months.push(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
  }
  return months;
}

function leaveStartHit(row: PlainRow, todayYm: string): { project: string; month: string } | null {
  const start = String(row.Start ?? row.start_date ?? row.start ?? "");
  const month = start.slice(0, 7);
  if (month.length !== 7) return null;
  const status = String(row.Status ?? row.status ?? "").toLowerCase();
  if (status === "rejected") return null;
  if (month > todayYm && status !== "approved") return null;
  if (month < todayYm && status === "pending") return null;
  return { project: String(row.Project ?? row.project ?? row.project_key ?? ""), month };
}

function leaveTense(yearMonth: string, todayYm: string): LeaveMonthBar["tense"] {
  if (yearMonth < todayYm) return "past";
  if (yearMonth === todayYm) return "current";
  return "future";
}

function buildCountMatrix(
  projects: { key: string; label: string }[],
  months: string[],
  hits: { project: string; month: string }[],
): { rows: MatrixRow[]; totals: number[]; grand: number } {
  const index = new Map(projects.map((project, row) => [project.key, row]));
  const labels = projects.map((project) => project);
  const cells = projects.map(() => months.map(() => 0));
  for (const hit of hits) {
    let row = index.get(hit.project);
    if (row == null) {
      row = labels.length;
      index.set(hit.project, row);
      labels.push({ key: hit.project, label: hit.project || "—" });
      cells.push(months.map(() => 0));
    }
    const column = months.indexOf(hit.month);
    const line = cells[row];
    if (column >= 0 && line) line[column] += 1;
  }
  const rows = labels.map((project, row) => {
    const line = cells[row] ?? [];
    return { key: project.key, label: project.label, cells: line, total: line.reduce((sum, count) => sum + count, 0) };
  });
  const totals = months.map((_, column) => rows.reduce((sum, row) => sum + (row.cells[column] ?? 0), 0));
  return { rows, totals, grand: totals.reduce((sum, count) => sum + count, 0) };
}

function StackBar({ row }: { row: ProjectRow }) {
  const parts = [
    { key: "working", count: row.working },
    { key: "onLeave", count: row.onLeave },
    { key: "absent", count: row.absent },
    { key: "sick", count: row.sick },
    { key: "other", count: row.other },
  ] as const;
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  if (total <= 0) return <div className="h-2.5 w-24 rounded-md bg-[#e3e5e8]" />;
  return (
    <div className="flex h-2.5 w-24 overflow-hidden rounded-md">
      {parts.filter((part) => part.count > 0).map((part) => (
        <div
          key={part.key}
          style={{ backgroundColor: dailyColor(part.key), width: `${(part.count / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

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
    case "accident":
      return t("barAccident");
    default:
      return key;
  }
}

function rosterSubtitle(filter: RosterFilter, count: number, t: Translator): string {
  switch (filter) {
    case "all":
      return t("rosterEveryone", { count });
    case "notWorking":
      return t("rosterNotWorking", { count });
    case "working":
    case "onLeave":
    case "absent":
    case "sick":
    case "other":
      return t("rosterStatusCount", { count, status: dailyLabel(filter, t) });
    default: {
      const neverFilter: never = filter;
      return neverFilter;
    }
  }
}

function formatJoined(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function projectLabelOf(key: string, projects: readonly ProjectRow[], fallback: string): string {
  return projects.find((row) => row.key === key)?.label || key || fallback;
}

function employeeLabel(key: EmployeeStatusKey, t: Translator): string {
  switch (key) {
    case "running":
      return t("statusRunning");
    case "extension":
      return t("statusExtension");
    case "leave":
      return t("statusLeave");
    case "new":
      return t("statusNew");
    case "absentFromMosal":
      return t("statusAbsentMosal");
    case "cancelled":
      return t("statusCancelled");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function leaveTypeLabel(value: string, t: Translator): string {
  switch (value) {
    case "annual":
      return t("typeAnnual");
    case "emergency":
      return t("typeEmergency");
    case "sick":
      return t("typeSick");
    case "unpaid":
      return t("typeUnpaid");
    default:
      return value;
  }
}

function planStatusLabel(status: string, t: Translator): string {
  switch (status) {
    case "pending":
      return t("statusPending");
    case "approved":
      return t("statusApproved");
    case "taken":
      return t("statusTaken");
    case "rejected":
      return t("statusRejected");
    default:
      return status;
  }
}

function outlookLabel(key: OutlookKey, t: Translator): string {
  switch (key) {
    case "returningThisWeek":
      return t("outlookReturning");
    case "startingThisWeek":
      return t("outlookStarting");
    case "pendingApproval":
      return t("outlookPending");
    case "overdue":
      return t("outlookOverdue");
    case "newJoiners":
      return t("outlookNewJoiners");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function jobCardLabel(key: JobEndCardKey, t: Translator): string {
  switch (key) {
    case "next30":
      return t("jobNext30");
    case "eoy":
      return t("jobEoy");
    case "next6m":
      return t("jobNext6m");
    case "noRenewal":
      return t("jobNoRenewal");
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

function scrollToLeave() {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("leave-plans")?.scrollIntoView({ behavior, block: "start" });
}

function MonthChart({
  months,
  selected,
  locale,
  barColor,
  onSelect,
}: {
  months: LeaveMonthBar[];
  selected?: string;
  locale: string;
  barColor?: string;
  onSelect: (yearMonth: string) => void;
}) {
  const max = Math.max(1, ...months.map((month) => month.count));
  return (
    <div className="flex h-36 items-end gap-1">
      {months.map((month) => {
        const height = Math.max(8, Math.round((month.count / max) * 100));
        const active = selected === month.yearMonth;
        return (
          <button
            key={month.yearMonth}
            type="button"
            className="flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1"
            onClick={() => onSelect(month.yearMonth)}
          >
            <span className="text-xs text-muted-foreground">{month.count}</span>
            <span
              className="w-full rounded-sm"
              style={{
                height: `${height}%`,
                minHeight: 8,
                outline: active ? "2px solid #714b67" : undefined,
                ...(barColor ? { background: barColor } : leaveBarStyle(month.tense)),
              }}
            />
            <span className="text-xs text-muted-foreground">{month.label || monthTick(month.yearMonth, locale)}</span>
          </button>
        );
      })}
    </div>
  );
}

function CountMatrix({
  months,
  matrix,
  locale,
  selected,
  totalLabel,
  allLabel,
  onProject,
}: {
  months: string[];
  matrix: { rows: MatrixRow[]; totals: number[]; grand: number };
  locale: string;
  selected?: string;
  totalLabel: string;
  allLabel: string;
  onProject: (key: string) => void;
}) {
  if (matrix.rows.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      <Table className={DENSE_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead className={TABLE_HEAD_CLASS} />
            {months.map((item) => (
              <TableHead key={item} className={TABLE_HEAD_CLASS}>{monthTick(item, locale)}</TableHead>
            ))}
            <TableHead className={TABLE_HEAD_CLASS}>{totalLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.rows.map((row) => (
            <TableRow
              key={row.key}
              style={
                selected && selected !== row.key
                  ? { opacity: 0.55 }
                  : selected === row.key
                    ? { background: "#f3ecf1", boxShadow: "inset 3px 0 0 #714b67" }
                    : undefined
              }
            >
              <TableCell>
                <button type="button" className="cursor-pointer text-[var(--btn-secondary-fg)]" onClick={() => onProject(row.key)}>
                  {row.label}
                </button>
              </TableCell>
              {row.cells.map((count, index) => (
                <TableCell key={`${row.key}-${months[index] ?? index}`}>{count}</TableCell>
              ))}
              <TableCell>{row.total}</TableCell>
            </TableRow>
          ))}
          <TableRow style={{ background: "#f8f9fa" }}>
            <TableCell>{allLabel}</TableCell>
            {matrix.totals.map((count, index) => (
              <TableCell key={`total-${months[index] ?? index}`}>{count}</TableCell>
            ))}
            <TableCell>{matrix.grand}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export function OperationsDashboardShell() {
  const t = useTranslations("pages.operationsDashboard");
  const locale = useLocale();
  const router = useRouter();
  const { accessKind } = useAuth();
  const readOnly = accessKind === "partner";
  const employeesHref = readOnly ? "/client-portal/employees" : "/drivers";
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectKey, setProjectKey] = useState<string | undefined>();
  const [month, setMonth] = useState<string | undefined>();
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const [customFrom, setCustomFrom] = useState(kuwaitTodayYmd());
  const [customTo, setCustomTo] = useState(kuwaitTodayYmd());
  const [zoneId, setZoneId] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [hireBy, setHireBy] = useState<"designation" | "zone" | "project">("designation");
  const [jobWindow, setJobWindow] = useState<JobWindow>("next6");
  const [leaveType, setLeaveType] = useState("");
  const [planProject, setPlanProject] = useState("");
  const today = kuwaitTodayYmd();
  const [outlook, setOutlook] = useState<OutlookFilter | null>(null);
  const [showAllLeaveRiders, setShowAllLeaveRiders] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<RosterFilter | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const rosterRef = useRef<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const bounds = periodBounds(period, today, customFrom, customTo);
    const result = await fetchOperationsDashboard({
      projectKey,
      month,
      from: bounds.from,
      to: bounds.to,
      zoneId: zoneId || undefined,
      vehicle: vehicle || undefined,
    });
    setDashboard(result.dashboard);
    setFailed(result.failed);
    setLoading(false);
  }, [projectKey, month, period, customFrom, customTo, today, zoneId, vehicle]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = dashboard;
  const plans = outlook && data ? data.outlook[outlook] : data?.leavePlans ?? [];
  const leaveRiders = data?.ridersOnLeave ?? [];
  const visibleRiders = showAllLeaveRiders ? leaveRiders : leaveRiders.slice(0, 8);
  const statusItems = selectOptions(
    PLAN_STATUSES.map((status) => ({ value: status, label: planStatusLabel(status, t) })),
  );

  const reload = () => {
    startTransition(() => {
      void load();
    });
  };

  const shownDay = data?.today || today;
  const shownFrom = data?.from || periodBounds(period, today, customFrom, customTo).from;
  const shownTo = data?.to || periodBounds(period, today, customFrom, customTo).to;
  const rangeActive = shownFrom !== shownTo;
  const activeProject = readOnly
    ? (data?.byProject.length === 1 ? data.byProject[0]?.key : undefined)
    : projectKey;
  const projectName = activeProject
    ? (data?.byProject.find((row) => row.key === activeProject)?.label ?? activeProject)
    : t("allProjects");
  const formatDay = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale === "ar" ? "ar" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const dateLabel = rangeActive ? `${formatDay(shownFrom)} – ${formatDay(shownTo)}` : formatDay(shownDay);
  const barTotal = (data?.statusBar ?? []).reduce((sum, item) => sum + item.count, 0);
  const rosterBase = filterRoster(data?.roster ?? [], rosterFilter ?? "all", "");
  const rosterRows = filterRoster(data?.roster ?? [], rosterFilter ?? "all", rosterQuery);
  const showPhone = !readOnly && (data?.roster ?? []).some((row) => row.phone !== "");
  const rosterProject = data?.byProject.find((project) => project.key === (readOnly ? data.byProject[0]?.key : projectKey))?.label ?? t("allProjects");

  const openRoster = (filter: RosterFilter) => {
    setRosterFilter((current) => (current === filter ? null : filter));
    setRosterQuery("");
  };

  useEffect(() => {
    if (!rosterFilter) return;
    rosterRef.current?.scrollIntoView({ block: "nearest" });
  }, [rosterFilter]);
  const statusTotal = (data?.employeeStatus ?? []).reduce((sum, row) => sum + row.count, 0);
  const typedPlans = plans.filter((row) => {
    if (leaveType && row.leaveType !== leaveType) return false;
    if (planProject && row.project !== planProject) return false;
    return true;
  });
  const visiblePlans = typedPlans.slice(0, 8);
  const year = (month || shownDay).slice(0, 4);
  const yearExports = (data?.exportLeaveYear ?? []).filter((row) => {
    const type = String(row["Leave Type"] ?? row.leave_type ?? "");
    return !leaveType || type === leaveType;
  });
  const todayYm = shownDay.slice(0, 7);
  const leaveHits = yearExports.flatMap((row) => {
    const hit = leaveStartHit(row, todayYm);
    return hit ? [hit] : [];
  });
  const monthCounts = new Map<string, number>();
  for (const hit of leaveHits) monthCounts.set(hit.month, (monthCounts.get(hit.month) ?? 0) + 1);
  const chart: LeaveMonthBar[] = Array.from({ length: 12 }, (_, index) => {
    const yearMonth = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { yearMonth, count: monthCounts.get(yearMonth) ?? 0, tense: leaveTense(yearMonth, todayYm) };
  });
  const leaveMatrix = buildCountMatrix(
    (data?.byProject ?? []).map((project) => ({ key: project.key, label: project.label })),
    chart.map((item) => item.yearMonth),
    leaveHits,
  );
  const jobMonths = jobWindowMonths(shownDay, jobWindow);
  const jobMonthSet = new Set(jobMonths);
  const jobHits = (data?.exportJobEnd ?? []).flatMap((row) => {
    const date = String(row["Job End Date"] ?? row.job_end_date ?? row.jobEndDate ?? "");
    const hitMonth = date.slice(0, 7);
    if (!jobMonthSet.has(hitMonth)) return [];
    if (jobWindow !== "past6" && hitMonth === todayYm && date < shownDay) return [];
    return [{ project: String(row.Project ?? row.project ?? ""), month: hitMonth }];
  });
  const jobCounts = new Map<string, number>();
  for (const hit of jobHits) jobCounts.set(hit.month, (jobCounts.get(hit.month) ?? 0) + 1);
  const jobChart: LeaveMonthBar[] = jobMonths.map((yearMonth) => ({
    yearMonth,
    count: jobCounts.get(yearMonth) ?? 0,
    tense: "future",
  }));
  const jobMatrix = buildCountMatrix(
    (data?.byProject ?? []).map((project) => ({ key: project.key, label: project.label })),
    jobMonths,
    jobHits,
  );
  const yearChoices = [0, 1, 2].map((delta) => String(Number(today.slice(0, 4)) - delta));
  if (!yearChoices.includes(year)) yearChoices.unshift(year);
  const leaveTypeItems = [
    { value: "all", label: t("leaveTypeAll") },
    ...LEAVE_TYPES.filter((type) => type !== "sick").map((type) => ({ value: type, label: leaveTypeLabel(type, t) })),
  ];
  const jobWindowItems = [
    { value: "next6", label: t("windowNext6") },
    { value: "next12", label: t("windowNext12") },
    { value: "past6", label: t("windowPast6") },
  ] as const;
  const titled = (label: string) => (activeProject ? `${label} — ${projectName}` : label);
  const scopedTitle = (label: string) => `${label} — ${projectName}`;
  const leaveSum = chart.reduce((sum, item) => sum + item.count, 0);
  const busiest = chart.reduce<LeaveMonthBar | undefined>(
    (best, item) => (!best || item.count > best.count ? item : best),
    undefined,
  );
  const novDec = yearExports.filter((row) => {
    const start = String(row.Start ?? row.start_date ?? "");
    const status = String(row.Status ?? row.status ?? "").toLowerCase();
    const mm = start.slice(5, 7);
    return (mm === "11" || mm === "12") && status === "approved";
  }).length;
  const planProjects = new Map<string, number>();
  for (const row of plans) {
    const key = row.project || "—";
    planProjects.set(key, (planProjects.get(key) ?? 0) + 1);
  }
  const zoneItems = [
    { value: "all", label: t("zoneAll") },
    ...(data?.zones ?? []).map((zone) => ({ value: zone.id, label: zone.name || zone.id })),
  ];
  const projectTotals = (data?.byProject ?? []).reduce(
    (sum, row) => ({
      assigned: sum.assigned + row.assigned,
      working: sum.working + row.working,
      onLeave: sum.onLeave + row.onLeave,
      absent: sum.absent + row.absent,
      sick: sum.sick + row.sick,
      other: sum.other + row.other,
    }),
    { assigned: 0, working: 0, onLeave: 0, absent: 0, sick: 0, other: 0 },
  );
  const card = "rounded-xl border bg-white p-4";

  return (
    <AppPage className="space-y-6 bg-[#f4f5f7]">
      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo framed size="lg" className="size-11 rounded-lg border-[#e3e5e8] bg-white p-1" />
            <div>
              <h1 className="type-h1 text-[#1f2328]">{t("title")}</h1>
              <p className="text-sm text-[#5c6370]">
                {rangeActive
                  ? t.rich("showingRange", {
                      name: projectName,
                      from: formatDay(shownFrom),
                      to: formatDay(shownTo),
                      b: (chunks) => <span className="font-semibold text-[#1f2328]">{chunks}</span>,
                    })
                  : t.rich("showing", {
                      name: projectName,
                      date: dateLabel,
                      b: (chunks) => <span className="font-semibold text-[#1f2328]">{chunks}</span>,
                    })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className={HEADER_BTN} disabled={loading || pending} onClick={reload}>
              <RefreshCw className="size-5" />
              {t("refresh")}
            </Button>
            <Button className={HEADER_BTN} variant="outline" onClick={() => openRoster("all")}>
              {rosterFilter === "all" ? t("showingList") : t("allRiders")}
            </Button>
            <Button className={HEADER_BTN} variant="outline" onClick={() => { setOutlook("pendingApproval"); scrollToLeave(); }}>
              {t("leaveRequests")}
            </Button>
            <Button
              className={HEADER_BTN}
              variant="outline"
              disabled={!data}
              onClick={() => {
                if (data) exportDashboard(data, t, projectName, periodLabel(period, t), dateLabel);
              }}
            >
              <Download className="size-5" />
              {t("exportDashboard")}
            </Button>
          </div>
        </div>
        <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-[#5c6370]">{t("colProject")}</p>
        <div className="flex flex-wrap gap-2">
          {readOnly ? null : (
            <ProjectPill active={!projectKey} label={t("allProjects")} onClick={() => setProjectKey(undefined)} />
          )}
          {(data?.byProject ?? []).map((project) => (
            <ProjectPill
              key={project.key}
              active={activeProject === project.key}
              label={project.label}
              onClick={() => {
                if (!readOnly) setProjectKey(project.key);
              }}
            />
          ))}
        </div>
        <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-[#5c6370]">{t("periodLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {DASHBOARD_PERIODS.map((item) => (
            <ProjectPill key={item} active={period === item} label={periodLabel(item, t)} onClick={() => setPeriod(item)} />
          ))}
        </div>
        {period === "custom" ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-[#5c6370]">
              {t("customFrom")}
              <Input className="mt-1 h-9" type="date" max={today} value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            </label>
            <label className="block text-xs text-[#5c6370]">
              {t("customTo")}
              <Input className="mt-1 h-9" type="date" max={today} value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </label>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-[#5c6370]">
          {rangeActive
            ? t("numbersForRange", { from: formatDay(shownFrom), to: formatDay(shownTo) })
            : t("numbersFor", { date: dateLabel })}
        </p>
        {rangeActive ? <p className="text-xs text-[#5c6370]">{t("rangeHint")}</p> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <FilterSelect label={t("filterZone")} value={zoneId || "all"} items={zoneItems} onChange={(value) => setZoneId(value === "all" ? "" : value)} />
          <FilterSelect label={t("filterVehicle")} value={vehicle || "all"} items={[{ value: "all", label: t("vehicleAll") }, { value: "bike", label: t("vehicleBike") }, { value: "car", label: t("vehicleCar") }]} onChange={(value) => setVehicle(value === "all" ? "" : value)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {(["working", "onLeave", "absent", "sick", "other"] as const).map((key) => {
            const count = data?.statusBar.find((item) => item.key === key)?.count ?? 0;
            return (
              <button key={key} type="button" className="inline-flex cursor-pointer items-center gap-1" style={{ color: legendColor(key) }} onClick={() => openRoster(key)}>
                <span className="size-2.5 rounded-sm" style={{ background: dailyColor(key) }} />
                {dailyLabel(key, t)} {count}
              </button>
            );
          })}
          <span className="ms-auto text-[#1f2328]">{t("totalRiders", { count: barTotal })}</span>
        </div>
        {barTotal === 0 ? (
          <p className="mt-2 text-sm text-[#5c6370]">{t("statusBarEmpty")}</p>
        ) : (
          <div className="mt-2 flex h-4 overflow-hidden rounded-md">
            {data?.statusBar.filter((item) => item.key !== "accident").map((item) => (
              <div key={item.key} style={{ backgroundColor: dailyColor(item.key), width: `${(item.count / barTotal) * 100}%` }} title={`${dailyLabel(item.key, t)} ${item.count}`} />
            ))}
          </div>
        )}
      </section>

      {failed ? <p className="text-sm text-destructive">{t("loadFailed")}</p> : null}
      {loading && !data ? <p className="text-sm text-[#5c6370]">{t("loading")}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        <Tile label={t("kpiTotal")} value={data?.kpis.assigned ?? 0} color="#714b67" action={rosterFilter === "all" ? t("showingList") : t("seeWho")} onAction={() => openRoster("all")} />
        <Tile label={t("kpiWorkingToday")} value={data?.kpis.working ?? 0} color="#22863a" valueColor="#1e7e34" action={rosterFilter === "working" ? t("showingList") : t("seeWho")} onAction={() => openRoster("working")} />
        <Tile label={t("kpiOnLeave")} value={data?.kpis.onLeave ?? 0} color="#1565c0" action={rosterFilter === "onLeave" ? t("showingList") : t("seeWho")} onAction={() => openRoster("onLeave")} />
        <Tile label={t("kpiAbsent")} value={data?.kpis.absent ?? 0} color="#c62828" valueColor="#b71c1c" action={rosterFilter === "absent" ? t("showingList") : t("seeWho")} onAction={() => openRoster("absent")} />
        <Tile label={t("kpiSick")} value={data?.kpis.sick ?? 0} color="#e8710a" valueColor="#b45309" action={rosterFilter === "sick" ? t("showingList") : t("seeWho")} onAction={() => openRoster("sick")} />
        <Tile label={t("kpiWorkingRate")} value={formatPct(data?.kpis.workingRate ?? 0)} color="#0f6e78" action={rosterFilter === "notWorking" ? t("showingList") : t("seeWhoNotWorking")} onAction={() => openRoster("notWorking")} />
        <Tile label={t("kpiAccident")} value={data?.kpis.accident ?? 0} color="#5c6370" />
      </div>

      {rosterFilter ? (
        <section ref={rosterRef} className={card} style={{ borderColor: "#e3e5e8" }}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#1f2328]">{t("allRiders")} — {rosterProject}</p>
              <p className="text-xs text-[#5c6370]">{rosterSubtitle(rosterFilter, rosterBase.length, t)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-56" value={rosterQuery} placeholder={t("rosterSearch")} onChange={(event) => setRosterQuery(event.target.value)} />
              <Button className={HEADER_BTN} variant="outline" onClick={() => exportRoster(rosterBase, showPhone, t, locale, data?.byProject ?? [])}>
                {t("rosterExport")}
              </Button>
              <Button className={HEADER_BTN} variant="outline" onClick={() => setRosterFilter(null)}>
                {t("rosterClose")}
              </Button>
            </div>
          </div>
          {rosterRows.length === 0 ? (
            <p className="text-sm text-[#5c6370]">{t("rosterEmpty")}</p>
          ) : (
            <div className="max-h-[min(360px,40dvh)] overflow-auto">
              <Table className={DENSE_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colProject")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colJoined")}</TableHead>
                    {showPhone ? <TableHead className={TABLE_HEAD_CLASS}>{t("colPhone")}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rosterRows.map((row, index) => (
                    <TableRow key={`${row.employeeId}-${index}`}>
                      <TableCell>{row.employeeId || "—"}</TableCell>
                      <TableCell>{row.name || "—"}</TableCell>
                      <TableCell>{projectLabelOf(row.project, data?.byProject ?? [], "—")}</TableCell>
                      <TableCell>{row.zone || "—"}</TableCell>
                      <TableCell>
                        <span className="inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold" style={{ color: dailyColor(row.status), borderColor: dailyColor(row.status) }}>
                          {dailyLabel(row.status, t)}
                        </span>
                      </TableCell>
                      <TableCell>{formatJoined(row.joined, locale)}</TableCell>
                      {showPhone ? <TableCell>{row.phone || "—"}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-[10px] text-[#5c6370]">{t("rosterFoot", { shown: rosterRows.length, total: rosterBase.length })}</p>
        </section>
      ) : null}

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#714b67" }}>
          <p className="text-sm uppercase">{titled(t("byProjectTitle"))}</p>
          {projectKey && !readOnly ? (
            <button type="button" className="cursor-pointer text-xs underline" onClick={() => setProjectKey(undefined)}>
              {t("showAllProjects")}
            </button>
          ) : null}
        </div>
        {(data?.byProject.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("byProjectEmpty")}</p>
        ) : (
          <Table className={DENSE_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colProject")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colTotal")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colWorking")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colOnLeave")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colAbsent")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colSick")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colOther")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colBreakdown")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.byProject.map((project) => (
                <TableRow key={project.key}>
                  <TableCell>
                    <button
                      type="button"
                      className="cursor-pointer text-[var(--btn-secondary-fg)]"
                      onClick={() => {
                        if (!readOnly) setProjectKey(project.key);
                      }}
                    >
                      {project.label}
                    </button>
                  </TableCell>
                  <TableCell>{project.assigned}</TableCell>
                  <TableCell>{project.working}</TableCell>
                  <TableCell>{project.onLeave}</TableCell>
                  <TableCell>{project.absent}</TableCell>
                  <TableCell>{project.sick}</TableCell>
                  <TableCell>{project.other}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StackBar row={project} />
                      <span className="text-xs text-[#5c6370]">
                        {t("workingShare", { pct: project.assigned ? roundPercent((project.working / project.assigned) * 100) : 0 })}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>{t("allProjects")}</TableCell>
                <TableCell>{projectTotals.assigned}</TableCell>
                <TableCell>{projectTotals.working}</TableCell>
                <TableCell>{projectTotals.onLeave}</TableCell>
                <TableCell>{projectTotals.absent}</TableCell>
                <TableCell>{projectTotals.sick}</TableCell>
                <TableCell>{projectTotals.other}</TableCell>
                <TableCell className="text-xs text-[#5c6370]">
                  {t("workingShare", { pct: projectTotals.assigned ? roundPercent((projectTotals.working / projectTotals.assigned) * 100) : 0 })}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-[#5c6370]">{t("byProjectFootnote")}</p>
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#714b67" }}>
          <p className="text-sm uppercase">{titled(t("employeeStatusTitle"))}</p>
          <button type="button" className="cursor-pointer text-xs underline" onClick={() => router.push(employeesHref)}>
            {t("viewEmployees")}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {(data?.employeeStatus ?? []).map((tile) => {
            const share = statusTotal === 0 ? 0 : roundPercent((tile.count / statusTotal) * 100);
            return (
              <div key={tile.key} className="rounded-lg border p-3" style={{ borderColor: employeeColor(tile.key) }}>
                <p className="text-xs" style={{ color: employeeColor(tile.key) }}>{employeeLabel(tile.key, t)}</p>
                <p className="text-base tabular-nums" style={{ color: employeeColor(tile.key) }}>{tile.count}</p>
                <p className="text-xs text-[#5c6370]">{t("ofRiders", { pct: share })}</p>
              </div>
            );
          })}
        </div>
        {(data?.statusByProject.length ?? 0) > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <Table className={DENSE_TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colProject")}</TableHead>
                  {(["running", "extension", "leave", "new", "absentFromMosal", "cancelled"] as const).map((key) => (
                    <TableHead key={key} className={TABLE_HEAD_CLASS}>{employeeLabel(key, t)}</TableHead>
                  ))}
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colTotal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.statusByProject.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{data?.byProject.find((project) => project.key === row.key)?.label ?? row.key}</TableCell>
                    <TableCell>{row.running}</TableCell>
                    <TableCell>{row.extension}</TableCell>
                    <TableCell>{row.leave}</TableCell>
                    <TableCell>{row.new}</TableCell>
                    <TableCell>{row.absentFromMosal}</TableCell>
                    <TableCell>{row.cancelled}</TableCell>
                    <TableCell>{row.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#0f6e78" }}>
          <p className="text-sm uppercase">{titled(t("leaveChartTitle"))}</p>
          <div className="flex flex-wrap gap-2">
            <Select
              items={yearChoices.map((item) => ({ value: item, label: item }))}
              value={year}
              onValueChange={(value) => {
                if (value) setMonth(`${value}-01`);
              }}
            >
              <SelectTrigger className="h-9 min-h-9 w-28 bg-white text-[#1f2328]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearChoices.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select items={leaveTypeItems} value={leaveType || "all"} onValueChange={(value) => setLeaveType(!value || value === "all" ? "" : value)}>
              <SelectTrigger className="h-9 min-h-9 w-36 bg-white text-[#1f2328]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {leaveTypeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={t("leaveTotal", { year })} value={leaveSum} color="#0f6e78" />
          <Tile label={t("leaveBusiest")} value={busiest ? monthTick(busiest.yearMonth, locale) : "—"} color="#1565c0" />
          <Tile label={t("leaveAverage")} value={chart.length ? Math.round(leaveSum / chart.length) : 0} color="#714b67" />
          <Tile label={t("leaveApprovedWindow")} value={novDec} color="#1e7e34" />
        </div>
        {chart.length === 0 ? (
          <p className="text-sm text-[#5c6370]">{t("leaveChartEmpty")}</p>
        ) : (
          <MonthChart months={chart} selected={month} locale={locale} onSelect={(yearMonth) => setMonth(yearMonth)} />
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#5c6370]">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "#1565c0" }} />{t("legendPast")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "#0f6e78" }} />{t("legendCurrent")}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm border border-dashed" style={{ background: "#dbe7f7", borderColor: "#1565c0" }} />{t("legendFuture")}</span>
        </div>
        <p className="mt-2 text-xs text-[#5c6370]">{t("leaveNovDecFootnote")}</p>
        <p className="mt-3 text-xs text-[#5c6370]">{t("leaveMatrixNote")}</p>
        <CountMatrix
          months={chart.map((item) => item.yearMonth)}
          matrix={leaveMatrix}
          locale={locale}
          selected={activeProject}
          totalLabel={t("colTotal")}
          allLabel={t("allProjects")}
          onProject={(key) => {
            if (!readOnly) setProjectKey(key || undefined);
          }}
        />
        <div id="leave-plans" className="mt-4 rounded-xl border p-4" style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[#1f2328]">
            {outlook ? t("planFiltered") : t("planTitle")}
          </p>
          <div className="flex flex-wrap gap-2">
            {outlook ? (
              <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setOutlook(null)}>
                {t("clearFilter")}
              </Button>
            ) : null}
            {readOnly ? null : (
              <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setAddOpen(true)}>
                {t("addLeave")}
              </Button>
            )}
            {readOnly ? null : (
              <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setImportOpen(true)}>
                {t("bulkImport")}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-9 cursor-pointer"
              onClick={() =>
                downloadCsv(
                  "leave-year.csv",
                  ["Employee ID", "Name", "Project", "Leave Type", "Start", "End", "Days", "Status"],
                  leaveExportRows(data?.exportLeaveYear ?? []),
                )
              }
            >
              {t("exportLeaveYear")}
            </Button>
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
              {t("exportLeaveMonth")}
            </Button>
          </div>
        </div>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("planEmpty")}</p>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap gap-2">
            <ProjectPill active={!planProject} label={t("projectAll")} onClick={() => setPlanProject("")} />
            {[...planProjects.entries()].map(([key, count]) => (
              <ProjectPill key={key} active={planProject === key} label={`${key} (${count})`} onClick={() => setPlanProject(key)} />
            ))}
          </div>
          <p className="mb-2 text-xs text-[#5c6370]">{t("ridersGoing", { count: typedPlans.length })}</p>
          <PlanTable
            rows={showAllPlans ? typedPlans : visiblePlans}
            statusItems={statusItems}
            t={t}
            onStatus={(id, status) => {
              startTransition(async () => {
                const result = await setLeavePlanStatus({ id, status });
                if (result.error) toast.error(t("saveFailed"));
                else {
                  toast.success(t("saved"));
                  await load();
                }
              });
            }}
            onDelete={setDeleteId}
            readOnly={readOnly}
          />
          {typedPlans.length > visiblePlans.length ? (
            <button type="button" className="mt-2 cursor-pointer text-xs text-[var(--btn-secondary-fg)]" onClick={() => setShowAllPlans((open) => !open)}>
              {showAllPlans ? t("viewLess") : t("showingFirst", { shown: visiblePlans.length, total: typedPlans.length })}
            </button>
          ) : null}
          </>
        )}
        </div>
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#b45309" }}>
          <p className="text-sm uppercase">{titled(t("jobEndTitle"))}</p>
          <div className="flex flex-wrap gap-2">
            <Select
              items={[...jobWindowItems]}
              value={jobWindow}
              onValueChange={(value) => {
                if (value === "next6" || value === "next12" || value === "past6") setJobWindow(value);
              }}
            >
              <SelectTrigger className="h-9 min-h-9 w-44 bg-white text-[#1f2328]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {jobWindowItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() =>
              downloadCsv(
                "job-end.csv",
                ["Employee ID", "Name", "Project", "Status", "Joining Date", "Job End Date", "Days Left", "Renewal Decision"],
                jobEndExportRows(data?.exportJobEnd ?? []),
              )
            }
          >
            {t("exportJobEnd")}
          </Button>
          </div>
        </div>
        {jobChart.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobEndEmpty")}</p>
        ) : (
          <MonthChart months={jobChart} locale={locale} barColor="#e8710a" onSelect={() => undefined} />
        )}
        <p className="mt-3 text-xs text-[#5c6370]">{t("jobMatrixNote")}</p>
        <CountMatrix
          months={jobMonths}
          matrix={jobMatrix}
          locale={locale}
          selected={activeProject}
          totalLabel={t("colTotal")}
          allLabel={t("allProjects")}
          onProject={(key) => {
            if (!readOnly) setProjectKey(key || undefined);
          }}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(["next30", "eoy", "next6m", "noRenewal"] as const).map((key) => (
            <Tile key={key} label={jobCardLabel(key, t)} value={data?.jobEndCards[key] ?? 0} color={key === "noRenewal" ? "#b71c1c" : "#b45309"} />
          ))}
        </div>
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <h2 className="text-sm font-semibold text-[#1f2328]">{scopedTitle(t("turnoverContractTitle"))}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={t("turnoverRate")} value={formatPct(data?.turnover.rate ?? 0)} color="#b71c1c" />
          <Tile label={t("turnoverEnded")} value={data?.turnover.ended ?? 0} color="#b45309" />
          <Tile label={t("turnoverAssumed")} value={data?.turnover.assumed ?? 0} color="#b45309" />
          <Tile label={t("turnoverTotal")} value={data?.turnover.total ?? 0} color="#1f2328" />
        </div>
        <p className="mt-3 text-xs text-[#5c6370]">{t("turnoverNote")}</p>
        {(data?.turnover.months.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("turnoverEmpty")}</p>
        ) : (
          <Table className={`${DENSE_TABLE} mt-3`}>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colMonth")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colCount")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("turnoverRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.turnover.months.map((monthRow) => (
                <TableRow key={monthRow.yearMonth}>
                  <TableCell>{monthLabel(monthRow.yearMonth, locale)}</TableCell>
                  <TableCell>{monthRow.count}</TableCell>
                  <TableCell>{formatPct(monthRow.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1f2328]">{scopedTitle(t("hiringTitle"))}</h2>
          <Select value={hireBy} onValueChange={(value) => setHireBy(hireByValue(value))}>
            <SelectTrigger className="h-9 min-h-9 w-44 bg-white text-[#1f2328]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {hireByItems(t).map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label={t("hiringCurrent")} value={data?.hiring.current ?? 0} color="#1f2328" />
          <Tile label={t("hiringLeaving")} value={data?.hiring.leaving ?? 0} color="#b45309" />
          <Tile label={t("hiringRequired")} value="—" color="#5c6370" />
          <Tile label={t("hiringPipeline")} value="—" color="#5c6370" />
          <Tile label={t("hiringToHire")} value="—" color="#5c6370" />
        </div>
        <p className="mt-3 text-xs text-[#5c6370]">{t("hiringNote")}</p>
        {hiringRows(data?.hiring, hireBy).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("hiringEmpty")}</p>
        ) : (
          <Table className={`${DENSE_TABLE} mt-3`}>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{hireBy === "designation" ? t("hiringDesignation") : hireBy === "zone" ? t("hiringZone") : t("hiringProject")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colCurrent")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colLeaving")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hiringRows(data?.hiring, hireBy).map((row) => (
                <TableRow key={row.label || "blank"}>
                  <TableCell>{row.label || "—"}</TableCell>
                  <TableCell>{row.current}</TableCell>
                  <TableCell>{row.leaving}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-white" style={{ background: "#1565c0" }}>
          <p className="text-sm uppercase">{t("ridersOnLeaveTitle")}</p>
          {leaveRiders.length > 8 ? (
            <Button
              variant="outline"
              className="h-9 cursor-pointer"
              onClick={() => setShowAllLeaveRiders((open) => !open)}
            >
              {showAllLeaveRiders ? t("viewLess") : t("viewAll")}
            </Button>
          ) : null}
        </div>
        {leaveRiders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ridersOnLeaveEmpty")}</p>
        ) : (
          <Table className={DENSE_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colProject")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colLeaveType")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colFrom")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colReturns")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRiders.map((row, index) => (
                <TableRow key={`${row.employeeId}-${index}`}>
                  <TableCell>{row.employeeId || "—"}</TableCell>
                  <TableCell>{row.name || "—"}</TableCell>
                  <TableCell>{row.project || "—"}</TableCell>
                  <TableCell>{row.leaveType ? leaveTypeLabel(row.leaveType, t) : "—"}</TableCell>
                  <TableCell>{row.start || "—"}</TableCell>
                  <TableCell style={row.returnWithin3Days ? { color: "#1e7e34", fontWeight: 600 } : undefined}>
                    {row.end || "—"}
                    {row.returnWithin3Days ? (
                      <span className="ms-2 text-xs">{t("returnSoon")}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className={card} style={{ borderColor: "#e3e5e8" }}>
        <div className="mb-3 rounded-lg px-3 py-2 text-white" style={{ background: "#1e7e34" }}>
          <p className="text-sm uppercase">{t("outlookTitle")}</p>
        </div>
        <ul className="divide-y divide-border">
          {(["returningThisWeek", "startingThisWeek", "pendingApproval", "overdue", "newJoiners"] as const).map(
            (key) => {
              const count = data?.outlook[key].length ?? 0;
              if (key === "newJoiners") {
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className="flex h-9 w-full cursor-pointer items-center justify-between text-sm"
                      onClick={() => router.push(employeesHref)}
                    >
                      <span>{outlookLabel(key, t)}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {count}
                        <ChevronRight className="size-5" />
                      </span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="flex h-9 w-full cursor-pointer items-center justify-between text-sm"
                    onClick={() => {
                      setOutlook(key);
                      scrollToLeave();
                    }}
                  >
                    <span>{outlookLabel(key, t)}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {count}
                      <ChevronRight className="size-5" />
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ul>
      </section>
      </div>

      <AddLeaveDialog
        open={addOpen}
        pending={pending}
        t={t}
        onOpenChange={setAddOpen}
        onSave={(input) => {
          startTransition(async () => {
            const result = await upsertLeavePlan(input);
            if (result.error) toast.error(t("saveFailed"));
            else {
              toast.success(t("saved"));
              setAddOpen(false);
              await load();
            }
          });
        }}
      />
      <ImportLeaveDialog
        open={importOpen}
        pending={pending}
        t={t}
        onOpenChange={setImportOpen}
        onImport={(csv) => {
          startTransition(async () => {
            const result = await importLeavePlans(csv);
            if (result.error === "empty_csv") toast.error(t("emptyCsv"));
            else if (result.error === "invalid_csv") toast.error(t("invalidCsv"));
            else if (result.error === "partial") {
              toast.error(t("importedPartial", { imported: result.imported ?? 0, failed: result.failed ?? 0 }));
              setImportOpen(false);
              await load();
            } else if (result.error) toast.error(t("saveFailed"));
            else {
              toast.success(t("imported"));
              setImportOpen(false);
              await load();
            }
          });
        }}
      />
      <Dialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent closeOutside showCloseButton className="w-[min(1200px,96vw)] max-w-none">
          <div className="px-5 pt-4" />
          <AppModalFooter title={t("deleteLeave")} subtitle={t("deleteLeaveSubtitle")}>
            <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setDeleteId(null)}>
              {t("cancel")}
            </Button>
            <Button
              className="h-9 cursor-pointer bg-destructive text-white hover:bg-destructive/90"
              disabled={pending || !deleteId}
              onClick={() => {
                if (!deleteId) return;
                const id = deleteId;
                startTransition(async () => {
                  const result = await deleteLeavePlan(id);
                  if (result.error) toast.error(t("saveFailed"));
                  else {
                    toast.success(t("saved"));
                    setDeleteId(null);
                    await load();
                  }
                });
              }}
            >
              <Trash2 className="size-5" />
              {t("delete")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}

function ProjectPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${PILL} ${
        active
          ? "border-transparent bg-[var(--btn-primary)] text-[var(--btn-primary-fg)] hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
          : "border-[var(--btn-secondary-border)] bg-transparent text-[var(--btn-secondary-fg)] hover:bg-[var(--btn-secondary-hover)] active:bg-[var(--btn-secondary-active)]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Tile({ label, value, color, valueColor, action, onAction }: { label: string; value: string | number; color: string; valueColor?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2" style={{ borderColor: "#e3e5e8", borderTop: `3px solid ${color}` }}>
      <p className="text-xl tabular-nums" style={{ color: valueColor ?? color }}>{value}</p>
      <p className="type-caption mt-1 uppercase tracking-wide text-[#5c6370]">{label}</p>
      {action && onAction ? (
        <button type="button" className="mt-1 cursor-pointer text-xs text-primary underline" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

function periodLabel(period: DashboardPeriod, t: Translator): string {
  switch (period) {
    case "today":
      return t("today");
    case "yesterday":
      return t("yesterday");
    case "thisWeek":
      return t("periodThisWeek");
    case "last7":
      return t("periodLast7");
    case "thisMonth":
      return t("periodThisMonth");
    case "lastMonth":
      return t("periodLastMonth");
    case "custom":
      return t("periodCustom");
    default: {
      const neverPeriod: never = period;
      return neverPeriod;
    }
  }
}

function hireByValue(value: string | null): "designation" | "zone" | "project" {
  if (value === "zone" || value === "project" || value === "designation") return value;
  return "designation";
}

function hireByItems(t: Translator) {
  return [
    { value: "designation", label: t("hiringDesignation") },
    { value: "zone", label: t("hiringZone") },
    { value: "project", label: t("hiringProject") },
  ];
}

function hiringRows(plan: OperationsDashboard["hiring"] | undefined, by: "designation" | "zone" | "project") {
  if (!plan) return [];
  switch (by) {
    case "designation":
      return plan.designation;
    case "zone":
      return plan.zone;
    case "project":
      return plan.project;
    default: {
      const neverBy: never = by;
      return neverBy;
    }
  }
}

function monthLabel(yearMonth: string, locale: string): string {
  return new Date(`${yearMonth}-01T12:00:00`).toLocaleDateString(locale, { month: "short", year: "numeric" });
}

function exportDashboard(data: OperationsDashboard, t: Translator, projectName: string, period: string, dateLabel: string) {
  const other = data.statusBar.find((row) => row.key === "other")?.count ?? data.kpis.other;
  downloadWorkbookXlsx("workforce-operations.xlsx", [{
    name: "Dashboard",
    aoa: [
      [t("title")],
      [dateLabel],
      [t("periodLabel"), period],
      [t("colProject"), projectName],
      [t("kpiTotal"), data.kpis.assigned],
      [t("kpiWorkingToday"), data.kpis.working],
      [t("kpiOnLeave"), data.kpis.onLeave],
      [t("kpiAbsent"), data.kpis.absent],
      [t("kpiSick"), data.kpis.sick],
      [t("kpiOther"), other],
      [t("kpiAccident"), data.kpis.accident],
      [t("kpiWorkingRate"), formatPct(data.kpis.workingRate)],
    ],
  }]);
}

function exportRoster(rows: readonly RosterRow[], showPhone: boolean, t: Translator, locale: string, projects: readonly ProjectRow[]) {
  const headers = [t("colEmployeeId"), t("colName"), t("colProject"), t("colZone"), t("colStatus"), t("colJoined")];
  if (showPhone) headers.push(t("colPhone"));
  downloadWorkbookXlsx("riders.xlsx", [{
    name: "Riders",
    aoa: [
      headers,
      ...rows.map((row) => {
        const cells: Array<string | number> = [
          row.employeeId,
          row.name,
          projectLabelOf(row.project, projects, ""),
          row.zone,
          dailyLabel(row.status, t),
          formatJoined(row.joined, locale),
        ];
        if (showPhone) cells.push(row.phone);
        return cells;
      }),
    ],
  }]);
}

function FilterSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[#5c6370]">
      {label}
      <Select items={items} value={value} onValueChange={(next) => onChange(next ?? value)}>
        <SelectTrigger className="h-9 w-full bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function PlanTable({
  rows,
  statusItems,
  t,
  onStatus,
  onDelete,
  readOnly = false,
}: {
  rows: LeavePlanRow[];
  statusItems: ReturnType<typeof selectOptions>;
  t: Translator;
  onStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}) {
  return (
    <Table className={DENSE_TABLE}>
      <TableHeader>
        <TableRow>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colProject")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colLeaveType")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colStart")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colEnd")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colDays")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
          <TableHead className={TABLE_HEAD_CLASS} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const statusValue = (PLAN_STATUSES as readonly string[]).includes(row.status) ? row.status : "pending";
          const items = (PLAN_STATUSES as readonly string[]).includes(row.status) || !row.status
            ? statusItems
            : selectOptions([
                ...PLAN_STATUSES.map((status) => ({ value: status, label: planStatusLabel(status, t) })),
                { value: row.status, label: row.status },
              ]);
          return (
            <TableRow key={row.id || `${row.employeeId}-${index}`}>
              <TableCell>{row.employeeId || "—"}</TableCell>
              <TableCell>{row.name || "—"}</TableCell>
              <TableCell>{row.project || "—"}</TableCell>
              <TableCell>{row.leaveType ? leaveTypeLabel(row.leaveType, t) : "—"}</TableCell>
              <TableCell>{row.start || "—"}</TableCell>
              <TableCell>{row.end || "—"}</TableCell>
              <TableCell>{row.days || "—"}</TableCell>
              <TableCell>
                {readOnly || row.source === "request" ? (
                  <span>{planStatusLabel(statusValue, t)}</span>
                ) : (
                  <Select
                    items={items}
                    value={row.status || statusValue}
                    disabled={!row.id}
                    onValueChange={(value) => {
                      if (value && row.id) onStatus(row.id, value);
                    }}
                  >
                    <SelectTrigger className="h-9 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={String(item.value)} value={String(item.value)}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TableCell>
              <TableCell>
                {readOnly || row.source === "request" ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-pointer text-destructive hover:bg-destructive/10"
                    disabled={!row.id}
                    onClick={() => { if (row.id) onDelete(row.id); }}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">{t("delete")}</span>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function AddLeaveDialog({
  open,
  pending,
  t,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  pending: boolean;
  t: Translator;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    employee_id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    status: string;
  }) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState("pending");
  const items = selectOptions(
    PLAN_STATUSES.map((value) => ({ value, label: planStatusLabel(value, t) })),
  );
  const typeItems = selectOptions(
    LEAVE_TYPES.map((value) => ({ value, label: leaveTypeLabel(value, t) })),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOutside showCloseButton className="w-[min(1200px,96vw)] max-w-none">
        <div className="space-y-3 px-5 pt-4">
          <label className="block space-y-1 text-xs">
            <span>{t("employeeId")}</span>
            <Input className="h-9" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} />
          </label>
          <label className="block space-y-1 text-xs">
            <span>{t("leaveType")}</span>
            <Select items={typeItems} value={leaveType} onValueChange={(value) => { if (value) setLeaveType(value); }}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeItems.map((item) => (
                  <SelectItem key={String(item.value)} value={String(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span>{t("startDate")}</span>
              <Input className="h-9" type="date" openPickerOnFocus={false} value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label className="block space-y-1 text-xs">
              <span>{t("endDate")}</span>
              <Input className="h-9" type="date" openPickerOnFocus={false} value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span>{t("status")}</span>
            <Select items={items} value={status} onValueChange={(value) => { if (value) setStatus(value); }}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={String(item.value)} value={String(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter title={t("addLeaveTitle")} subtitle={t("addLeaveSubtitle")}>
            <Button variant="outline" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              className="h-9 cursor-pointer"
              disabled={pending || !employeeId.trim() || !start || !end}
              onClick={() =>
                onSave({
                  employee_id: employeeId.trim(),
                  leave_type: leaveType.trim(),
                  start_date: start,
                  end_date: end,
                  status,
                })
              }
            >
              {pending ? t("saving") : t("save")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportLeaveDialog({
  open,
  pending,
  t,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  pending: boolean;
  t: Translator;
  onOpenChange: (open: boolean) => void;
  onImport: (csv: string) => void;
}) {
  const [csv, setCsv] = useState("employee_id,leave_type,start_date,end_date,status\n");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOutside showCloseButton className="w-[min(1200px,96vw)] max-w-none">
        <div className="space-y-3 px-5 pt-4">
          <label className="block space-y-1 text-xs">
            <span>{t("csvLabel")}</span>
            <Textarea className="min-h-36 font-mono text-xs" value={csv} onChange={(event) => setCsv(event.target.value)} />
          </label>
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter title={t("bulkImportTitle")} subtitle={t("bulkImportSubtitle")}>
            <Button variant="outline" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button className="h-9 cursor-pointer" disabled={pending || !csv.trim()} onClick={() => onImport(csv)}>
              {pending ? t("saving") : t("bulkImport")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
