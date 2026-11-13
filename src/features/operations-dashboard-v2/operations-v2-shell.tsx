"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BarChart2,
  ChevronRight,
  Download,
  Info,
  PieChart,
  RefreshCw,
  Search,
  Sliders,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppTableColumnPicker } from "@/components/app/app-table-column-picker";
import { KpiCard } from "@/components/dashboard/kpi-card";
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
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useTableColumnVisibility, type TableColumnVisibilityOption } from "@/hooks/use-table-column-visibility";
import { downloadCsv } from "@/lib/csv/client-download";
import { formatKuwaitDateLabel, kuwaitSatFriWeek, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatPct, roundPercent } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import {
  fetchOperationsDashboard,
  fetchOperationsHubConfig,
  saveOperationsHubConfig,
  importLeavePlans,
  upsertLeavePlan,
} from "@/features/operations-dashboard/operations-dashboard-actions";
import {
  DASHBOARD_PERIODS,
  DEFAULT_OPS_HUB_CONFIG,
  filterRoster,
  leaveExportRows,
  periodBounds,
  type DashboardPeriod,
  type EmployeeStatusKey,
  type JobEndCardKey,
  type LeaveMonthBar,
  type OutlookKey,
  type OperationsDashboard,
  type OperationsHubConfig,
  type RiderOnLeaveRow,
  type RosterRow,
  type RosterStatus,
} from "@/features/operations-dashboard/shape";
import {
  MonthBars,
  TONE_FILL,
  V2Card,
  V2CardHeader,
  V2Empty,
  V2Note,
  V2PageHeader,
  V2Stat,
  V2Surface,
  V2TableShell,
  type MonthBarItem,
  type V2Tone,
} from "@/features/portal-v2/v2-ui";
import { jobEndMatrix, monthLabel, upcomingLeaveRows, type UpcomingLeaveRow } from "./helpers";
import { CustomColumnsDialog } from "./custom-columns-dialog";
import {
  planRosterColumns,
  rosterCustomFieldText,
  visibleRosterColumns,
} from "./custom-columns";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";
import { formatCustomFieldDisplay } from "@/lib/custom-fields/validate";
import { DRIVER_ENTITY_TYPE, type CustomFieldDefinition, type CustomFieldValue } from "@/lib/custom-fields/types";
import { v2DayMonth, v2WeekdayDate } from "@/features/portal-v2/v2-format";

type Translator = ReturnType<typeof useTranslations<"pages.operationsDashboardV2">>;
/** One KPI card's list: every rider, one roster status, or the Accident employee status. */
type RosterView = "all" | RosterStatus | "accident";

type OperationsV2Column<T> = TableColumnVisibilityOption & {
  headClassName?: string;
  cellClassName?: string;
  render: (row: T) => React.ReactNode;
};

function columnsInOrder<T>(columns: OperationsV2Column<T>[], visibleIds: string[]): OperationsV2Column<T>[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  return visibleIds
    .map((id) => byId.get(id))
    .filter((column): column is OperationsV2Column<T> => Boolean(column));
}

const HEAD_BTN = "h-9 cursor-pointer";
const SELECT = "h-9 min-h-9 border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]";
const TABLE = "text-[13px] [&_thead_tr]:bg-[var(--surface-subtle)] [&_td]:px-3 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-3";
const TH = "text-start text-[12px] font-medium text-[var(--text-secondary)]";

/** The six leave statuses the frame prints, in the frame's order. */
const STATUS_TONES: Record<string, V2Tone> = {
  working: "working",
  onLeave: "leave",
  sick: "sick",
  absent: "absent",
  other: "neutral",
  accident: "accident",
};

const EMPLOYEE_TONES: Record<EmployeeStatusKey, V2Tone> = {
  running: "working",
  extension: "working",
  leave: "leave",
  new: "sick",
  absentFromMosal: "absent",
  cancelled: "neutral",
};

const LEAVE_TYPE_KEYS = ["annual", "emergency", "sick", "unpaid"] as const;
const PLAN_STATUSES = ["pending", "approved", "taken", "rejected"] as const;

function weekdayDate(ymd: string, locale: string): string {
  return v2WeekdayDate(ymd, locale);
}

function rateOf(part: number, whole: number): number {
  if (!whole) return 0;
  return roundPercent((part / whole) * 100);
}

function leaveTypeLabel(type: string, t: Translator): string {
  switch (type) {
    case "sick":
      return t("typeSick");
    case "emergency":
      return t("typeEmergency");
    case "unpaid":
      return t("typeUnpaid");
    default:
      return t("typeAnnual");
  }
}

function planStatusLabel(status: string, t: Translator): string {
  switch (status) {
    case "approved":
      return t("statusApproved");
    case "taken":
      return t("statusTaken");
    case "rejected":
      return t("statusRejected");
    default:
      return t("statusPending");
  }
}

function statusVariant(status: string): string {
  switch (status) {
    case "approved":
      return "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]";
    case "taken":
      return "bg-[var(--status-leave-bg)] text-[var(--status-leave-fg)]";
    case "rejected":
      return "bg-[var(--status-absent-bg)] text-[var(--status-absent-fg)]";
    default:
      return "bg-[var(--status-sick-bg)] text-[var(--status-sick-fg)]";
  }
}

function contractLabel(key: EmployeeStatusKey, t: Translator): string {
  switch (key) {
    case "running":
      return t("contractRunning");
    case "extension":
      return t("contractExtension");
    case "leave":
      return t("contractOnLeave");
    case "new":
      return t("contractNew");
    case "absentFromMosal":
      return t("contractAbsentMosal");
    case "cancelled":
      return t("contractCancelled");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

function statusLabel(key: string, t: Translator): string {
  switch (key) {
    case "working":
      return t("kpiWorking");
    case "onLeave":
      return t("kpiOnLeave");
    case "sick":
      return t("kpiSick");
    case "absent":
      return t("kpiAbsent");
    case "accident":
      return t("kpiAccident");
    default:
      return t("kpiNotMarked");
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

export function OperationsV2Shell() {
  const t = useTranslations("pages.operationsDashboardV2");
  const tBase = useTranslations("pages.operationsDashboard");
  const locale = useLocale();
  const { accessKind, isSuperAdmin } = useAuth();
  const readOnly = accessKind === "partner";

  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectKey, setProjectKey] = useState<string | undefined>();
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const [zoneId, setZoneId] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [nationalityCategory, setNationalityCategory] = useState("");
  const [nationalityCountry, setNationalityCountry] = useState("");
  const [hubConfig, setHubConfig] = useState<OperationsHubConfig>(DEFAULT_OPS_HUB_CONFIG);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("");
  const [planProject, setPlanProject] = useState("");
  const [outlookKey, setOutlookKey] = useState<OutlookKey | null>(null);
  const [rosterView, setRosterView] = useState<RosterView | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterProject, setRosterProject] = useState("all");
  const [allUpcomingOpen, setAllUpcomingOpen] = useState(false);
  const [allAwayOpen, setAllAwayOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pending] = useTransition();
  const [updatedAt, setUpdatedAt] = useState("");
  const leavePlannerRef = useRef<HTMLDivElement | null>(null);
  const rosterRef = useRef<HTMLDivElement | null>(null);

  const today = kuwaitTodayYmd();
  const bounds = useMemo(() => periodBounds(period, today, today, today), [period, today]);
  const customFieldsQuery = useCustomFieldDefinitions(DRIVER_ENTITY_TYPE);
  const customFieldDefinitions = useMemo(() => customFieldsQuery.data ?? [], [customFieldsQuery.data]);

  useEffect(() => {
    void fetchOperationsHubConfig().then((res) => {
      if (res.config) setHubConfig(res.config);
    });
  }, []);

  const load = useCallback(
    () =>
      fetchOperationsDashboard({
        projectKey,
        from: bounds.from,
        to: bounds.to,
        zoneId: zoneId || undefined,
        vehicle: vehicle || undefined,
        nationalityCategory: nationalityCategory || undefined,
        nationalityCountry: nationalityCountry || undefined,
      }),
    [projectKey, bounds.from, bounds.to, zoneId, vehicle, nationalityCategory, nationalityCountry],
  );

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchOperationsDashboard>>) => {
    setDashboard(result.dashboard);
    setFailed(result.failed);
    setLoading(false);
    setUpdatedAt(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kuwait",
      }).format(new Date()),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [load, apply]);

  const reload = useCallback(() => {
    setLoading(true);
    void load().then(apply);
  }, [load, apply]);

  const data = dashboard;
  const projects = data?.byProject ?? [];
  const activeProjects = projects.filter((row) => row.assigned > 0).length;
  const kpis = data?.kpis;
  const mixRows = data?.statusBar ?? [];
  const mixTotal = mixRows.reduce((sum, row) => sum + row.count, 0);
  const accidentCount = kpis?.accident ?? 0;

  const rosterSource = data?.roster ?? [];
  const rosterStatusRows = useMemo(() => {
    if (!rosterView) return [];
    const base =
      rosterView === "accident"
        ? rosterSource.filter((row) => row.employeeStatus === "accident")
        : filterRoster(rosterSource, rosterView, "");
    return rosterProject === "all" ? base : base.filter((row) => (row.project || "unassigned") === rosterProject);
  }, [rosterSource, rosterView, rosterProject]);
  const rosterRows = useMemo(() => filterRoster(rosterStatusRows, "all", rosterQuery), [rosterStatusRows, rosterQuery]);
  const rosterProjectLabel = rosterProject === "all" ? t("allProjects") : projectName(rosterProject, t);
  const rosterSubtitle = rosterView
    ? rosterView === "all"
      ? t("rosterEveryone", { count: rosterStatusRows.length })
      : t("rosterStatusCount", {
          count: rosterStatusRows.length,
          status: rosterView === "accident" ? t("kpiAccident") : statusLabel(rosterView, t),
        })
    : "";

  const customFieldByKey = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition>();
    for (const definition of customFieldDefinitions) map.set(definition.key, definition);
    return map;
  }, [customFieldDefinitions]);

  const rosterColumns = useMemo<OperationsV2Column<RosterRow>[]>(() => {
    const columns: OperationsV2Column<RosterRow>[] = [
      {
        id: "employeeId",
        label: t("colEmployeeId"),
        locked: true,
        cellClassName: "tabular-nums",
        render: (row) => row.employeeId || "—",
      },
      {
        id: "name",
        label: t("colName"),
        cellClassName: "font-medium",
        render: (row) => row.name || "—",
      },
      {
        id: "project",
        label: t("colProject"),
        render: (row) => projectName(row.project, t),
      },
      {
        id: "zone",
        label: t("colZone"),
        render: (row) => row.zone || "—",
      },
      {
        id: "status",
        label: t("colStatus"),
        render: (row) => (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusVariant(row.status)}`}>
            {statusLabel(row.status, t)}
          </span>
        ),
      },
      {
        id: "joined",
        label: t("colJoined"),
        cellClassName: "tabular-nums",
        render: (row) => (row.joined ? formatKuwaitDateLabel(row.joined) : "—"),
      },
      {
        id: "nationalityCategory",
        label: t("colNationalityCategory"),
        render: (row) => (
          <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium bg-[var(--surface-subtle)] text-[var(--text-primary)]">
            {row.nationalityCategory || "—"}
          </span>
        ),
      },
      {
        id: "nationalityCountry",
        label: t("colNationalityCountry"),
        render: (row) => (
          <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium bg-[var(--surface-subtle)] text-[var(--text-primary)]">
            {row.nationalityCountry || "—"}
          </span>
        ),
      },
    ];
    if (!readOnly) {
      columns.push({
        id: "phone",
        label: t("colPhone"),
        render: (row) => <span dir="ltr">{row.phone || "—"}</span>,
      });
    }

    /**
     * The stored definition decides the order, the headings and which columns
     * exist at all; the renderers above stay the app's own, so a renamed column
     * still prints a real status pill rather than a raw enum key.
     */
    const byId = new Map(columns.map((column) => [column.id, column]));
    const ordered: OperationsV2Column<RosterRow>[] = [];
    for (const entry of visibleRosterColumns(
      planRosterColumns(hubConfig.customColumns, { includePhone: !readOnly }),
    )) {
      if (entry.kind === "base") {
        const base = byId.get(entry.id);
        if (!base) continue;
        ordered.push(entry.label ? { ...base, label: entry.label } : base);
        continue;
      }
      const definition = customFieldByKey.get(entry.field);
      ordered.push({
        id: entry.id,
        label: entry.label,
        render: (row) => {
          const value = entry.field ? row.customFields?.[entry.field] : undefined;
          if (definition) {
            return (
              formatCustomFieldDisplay(
                definition.field_type,
                value as CustomFieldValue,
                definition.options ?? [],
              ) || "—"
            );
          }
          return rosterCustomFieldText(value);
        },
      });
    }
    return ordered;
  }, [t, readOnly, hubConfig.customColumns, customFieldByKey]);
  /**
   * The definition is part of the per-user storage key.
   *
   * `useTableColumnVisibility` remembers this operator's own order and hidden
   * columns, which would otherwise outrank a change an admin just made — the
   * saved order would win and the global reorder would look like it did nothing.
   * A definition change therefore starts a fresh personal order, so an edit in the
   * dialog is visible in the table immediately, for everyone.
   */
  const rosterColumnSignature = useMemo(() => rosterColumns.map((column) => column.id).join("|"), [rosterColumns]);
  const rosterColumnVisibility = useTableColumnVisibility(
    `dpd:operations-v2:roster-columns:${rosterColumnSignature}`,
    rosterColumns,
  );
  const rosterVisibleColumns = columnsInOrder(rosterColumns, rosterColumnVisibility.orderedVisibleColumnIds);

  const openRoster = useCallback(
    (view: RosterView) => {
      const closing = rosterView === view;
      setRosterView(closing ? null : view);
      setRosterQuery("");
      setRosterProject("all");
      if (!closing) {
        window.setTimeout(() => rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
    },
    [rosterView],
  );

  const periodItems = useMemo(() => {
    const day = (value: DashboardPeriod) => v2DayMonth(periodBounds(value, today, today, today).from, locale);
    return selectOptions(
      DASHBOARD_PERIODS.filter((value) => value !== "custom").map((value) => ({
        value,
        label:
          value === "today"
            ? `${t("today")}, ${day("today")}`
            : value === "yesterday"
              ? `${t("yesterday")}, ${day("yesterday")}`
              : value === "thisWeek"
                ? tBase("periodThisWeek")
                : value === "thisMonth"
                  ? tBase("periodThisMonth")
                  : tBase("periodLastMonth"),
      })),
    );
  }, [t, tBase, today, locale]);

  const zoneItems = useMemo(
    () => [
      { value: "all", label: t("allZones") },
      ...(data?.zones ?? []).map((zone) => ({ value: zone.id, label: zone.name || zone.id })),
    ],
    [data?.zones, t],
  );

  const vehicleItems = useMemo(
    () => [
      { value: "all", label: t("allVehicles") },
      { value: "bike", label: t("vehicleBike") },
      { value: "car", label: t("vehicleCar") },
    ],
    [t],
  );

  const projectTotals = useMemo(
    () =>
      projects.reduce(
        (sum, row) => ({
          assigned: sum.assigned + row.assigned,
          working: sum.working + row.working,
          onLeave: sum.onLeave + row.onLeave,
          sick: sum.sick + row.sick,
          absent: sum.absent + row.absent,
          other: sum.other + row.other,
        }),
        { assigned: 0, working: 0, onLeave: 0, sick: 0, absent: 0, other: 0 },
      ),
    [projects],
  );

  const employeeTotal = (data?.employeeStatus ?? []).reduce((sum, tile) => sum + tile.count, 0);
  const statusMatrix = data?.statusByProject ?? [];
  const statusTotals = statusMatrix.reduce(
    (sum, row) => ({
      running: sum.running + row.running,
      extension: sum.extension + row.extension,
      leave: sum.leave + row.leave,
      new: sum.new + row.new,
      absentFromMosal: sum.absentFromMosal + row.absentFromMosal,
      cancelled: sum.cancelled + row.cancelled,
      total: sum.total + row.total,
    }),
    { running: 0, extension: 0, leave: 0, new: 0, absentFromMosal: 0, cancelled: 0, total: 0 },
  );

  const monthsElapsed = Number(today.slice(5, 7));
  const year = today.slice(0, 4);
  const leaveBars: MonthBarItem[] = (data?.leaveMonths ?? []).map((bar) => ({
    key: bar.yearMonth,
    label: monthLabel(bar.yearMonth),
    value: bar.count,
    tone: bar.tense === "current" ? "current" : bar.tense === "future" ? "future" : "past",
  }));
  const leaveTaken = (data?.leaveMonths ?? [])
    .filter((bar) => bar.tense !== "future")
    .reduce((sum, bar) => sum + bar.count, 0);
  const busiest = (data?.leaveMonths ?? []).reduce<LeaveMonthBar | undefined>(
    (best, bar) => (!best || bar.count > best.count ? bar : best),
    undefined,
  );
  const monthlyAverage = monthsElapsed > 0 ? Math.round(leaveTaken / monthsElapsed) : 0;
  const approvedUpcoming = (data?.exportLeaveYear ?? []).filter((row) => {
    const start = String(row.Start ?? row.start_date ?? "");
    const status = String(row.Status ?? row.status ?? "").toLowerCase();
    const month = start.slice(5, 7);
    return (month === "11" || month === "12") && status === "approved";
  }).length;

  const upcoming = useMemo(() => {
    const rows = upcomingLeaveRows(data?.leavePlans ?? [], today, 60);
    return leaveType ? rows.filter((row) => row.leaveType === leaveType) : rows;
  }, [data?.leavePlans, leaveType, today]);

  const upcomingByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of upcoming) counts.set(row.project, (counts.get(row.project) ?? 0) + 1);
    return counts;
  }, [upcoming]);

  const shownUpcoming = planProject
    ? upcoming.filter((row) => row.project === planProject)
    : upcoming;
  const upcomingRows = allUpcomingOpen ? shownUpcoming : shownUpcoming.slice(0, 5);

  const jobMonths = (data?.jobEndMonths ?? []).slice(0, 6);
  const jobBars: MonthBarItem[] = jobMonths.map((bar) => ({
    key: bar.yearMonth,
    label: monthLabel(bar.yearMonth),
    value: bar.count,
    tone: "gold",
  }));
  const jobMatrix = useMemo(
    () => jobEndMatrix(data?.exportJobEnd ?? [], jobMonths.map((bar) => bar.yearMonth)),
    [data?.exportJobEnd, jobMonths],
  );
  const jobMonthTotals = jobMonths.map((bar) =>
    jobMatrix.reduce((sum, row) => sum + (row.counts[bar.yearMonth] ?? 0), 0),
  );

  const away = data?.ridersOnLeave ?? [];
  const awayRows = allAwayOpen ? away : away.slice(0, 6);

  const upcomingColumns = useMemo<OperationsV2Column<UpcomingLeaveRow>[]>(
    () => [
      {
        id: "employeeId",
        label: t("colEmployeeId"),
        locked: true,
        cellClassName: "tabular-nums",
        render: (row) => row.employeeId,
      },
      {
        id: "name",
        label: t("colName"),
        cellClassName: "font-medium",
        render: (row) => row.name,
      },
      {
        id: "project",
        label: t("colProject"),
        render: (row) =>
          row.project === "unassigned"
            ? t("projectUnassigned")
            : row.project === "keeta"
              ? t("projectKeeta")
              : row.project === "americana"
                ? t("projectAmericana")
                : row.project,
      },
      {
        id: "leaveType",
        label: t("colLeaveType"),
        render: (row) => leaveTypeLabel(row.leaveType, t),
      },
      {
        id: "start",
        label: t("colStart"),
        cellClassName: "tabular-nums",
        render: (row) => formatKuwaitDateLabel(row.start),
      },
      {
        id: "end",
        label: t("colEnd"),
        cellClassName: "tabular-nums",
        render: (row) => formatKuwaitDateLabel(row.end),
      },
      {
        id: "days",
        label: t("colDays"),
        headClassName: `${TH} text-center`,
        cellClassName: "text-center tabular-nums",
        render: (row) => row.days,
      },
      {
        id: "status",
        label: t("colStatus"),
        render: (row) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusVariant(row.status)}`}>
            {planStatusLabel(row.status, t)}
          </span>
        ),
      },
    ],
    [t],
  );
  const upcomingColumnVisibility = useTableColumnVisibility("dpd:operations-v2:upcoming-leave-columns", upcomingColumns);
  const upcomingVisibleColumns = columnsInOrder(upcomingColumns, upcomingColumnVisibility.orderedVisibleColumnIds);

  const awayColumns = useMemo<OperationsV2Column<RiderOnLeaveRow>[]>(
    () => [
      {
        id: "rider",
        label: t("colRider"),
        locked: true,
        cellClassName: "font-medium",
        render: (row) => row.name,
      },
      {
        id: "project",
        label: t("colProject"),
        render: (row) => projectName(row.project, t),
      },
      {
        id: "since",
        label: t("colSince"),
        cellClassName: "tabular-nums",
        render: (row) => formatKuwaitDateLabel(row.start),
      },
      {
        id: "backOn",
        label: t("colBackOn"),
        render: (row) => {
          const back = backState(row.end, today, t("today"), tBase("outlookOverdue"));
          return (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${back.className}`}>
              <span className={`size-1.5 rounded-full ${back.dot}`} aria-hidden />
              {back.label}
            </span>
          );
        },
      },
    ],
    [t, tBase, today],
  );
  const awayColumnVisibility = useTableColumnVisibility("dpd:operations-v2:away-riders-columns", awayColumns);
  const awayVisibleColumns = columnsInOrder(awayColumns, awayColumnVisibility.orderedVisibleColumnIds);

  const outlookRows: { key: OutlookKey; count: number; tone: V2Tone }[] = [
    { key: "returningThisWeek", count: data?.outlook.returningThisWeek.length ?? 0, tone: "working" },
    { key: "startingThisWeek", count: data?.outlook.startingThisWeek.length ?? 0, tone: "working" },
    { key: "pendingApproval", count: data?.outlook.pendingApproval.length ?? 0, tone: "sick" },
    { key: "overdue", count: data?.outlook.overdue.length ?? 0, tone: "absent" },
    { key: "newJoiners", count: data?.outlook.newJoiners.length ?? 0, tone: "neutral" },
  ];

  const week = kuwaitSatFriWeek(today);
  const weekRange = `${formatKuwaitDateLabel(week.start)} – ${formatKuwaitDateLabel(week.end)}`;
  const employeesHref = readOnly ? "/client-portal-v2/employees" : "/drivers";
  const contractCards: { key: JobEndCardKey; label: string }[] = [
    { key: "next30", label: t("next30Days") },
    { key: "eoy", label: tBase("jobEoy") },
    { key: "next6m", label: t("next6Months") },
    { key: "noRenewal", label: tBase("jobNoRenewal") },
  ];

  function exportProjects() {
    const rows: string[][] = projects.map((row) => [
      projectName(row.key, t),
      String(row.assigned),
      String(row.working),
      String(row.onLeave),
      String(row.sick),
      String(row.absent),
      String(row.other),
      formatPct(rateOf(row.working, row.assigned)),
    ]);
    downloadCsv(
      `riders-by-project-${today}.csv`,
      [
        t("colProject"),
        t("colTotal"),
        t("colWorking"),
        t("colOnLeave"),
        t("colSick"),
        t("colAbsent"),
        t("colNotMarked"),
        t("colWorkingRate"),
      ],
      rows,
    );
  }

  function exportRoster() {
    if (!rosterView) return;
    downloadCsv(
      `riders-${rosterView}-${today}.csv`,
      [
        t("colEmployeeId"),
        t("colName"),
        t("colProject"),
        t("colZone"),
        "Nationality Category",
        "Nationality Country",
        t("colStatus"),
        t("colJoined"),
        ...(readOnly ? [] : [t("colPhone")]),
      ],
      rosterStatusRows.map((row) => [
        row.employeeId,
        row.name,
        projectName(row.project, t),
        row.zone,
        row.nationalityCategory || "—",
        row.nationalityCountry || "—",
        statusLabel(row.status, t),
        row.joined,
        ...(readOnly ? [] : [row.phone]),
      ]),
    );
  }

  function exportUpcoming() {
    downloadCsv(
      `leave-plan-${today}.csv`,
      [t("colEmployeeId"), t("colName"), t("colProject"), t("colLeaveType"), t("colStart"), t("colEnd"), t("colDays"), t("colStatus")],
      leaveExportRows(shownUpcoming as unknown as Record<string, unknown>[]),
    );
  }

  function exportJobEnd() {
    downloadCsv(
      `contract-end-${today}.csv`,
      [t("colProject"), ...jobMonths.map((bar) => monthLabel(bar.yearMonth)), t("colTotal")],
      jobMatrix.map((row) => [
        row.project,
        ...jobMonths.map((bar) => String(row.counts[bar.yearMonth] ?? 0)),
        String(row.total),
      ]),
    );
  }

  const natCategoryItems = useMemo(() => {
    const fromApi = (data?.byNationalityCategory ?? []).map((c) => ({
      value: c.key,
      label: `${c.key} (${c.count})`,
    }));
    return selectOptions([
      { value: "all", label: "All Categories" },
      ...fromApi,
    ]);
  }, [data?.byNationalityCategory]);

  const natCountryItems = useMemo(() => {
    const fromApi = (data?.byNationalityCountry ?? []).map((c) => ({
      value: c.key,
      label: `${c.key} (${c.count})`,
    }));
    return selectOptions([
      { value: "all", label: "All Countries" },
      ...fromApi,
    ]);
  }, [data?.byNationalityCountry]);

  /**
   * One write per change. The dialog reports the outcome itself, so this returns
   * a boolean instead of toasting — a toast per toggle would be noise on a screen
   * whose whole point is that the change is already applied.
   */
  const handleSaveHubConfig = async (newConfig: OperationsHubConfig): Promise<boolean> => {
    const res = await saveOperationsHubConfig(newConfig);
    if (!res.ok) return false;
    setHubConfig(newConfig);
    return true;
  };

  return (
    <V2Surface>
      <V2PageHeader
        icon={<Users className="size-6" strokeWidth={2} />}
        breadcrumbs={[t("breadcrumbApps"), t("breadcrumbSelf")]}
        title={t("title")}
        subtitle={t("subtitle", { date: weekdayDate(today, locale), time: updatedAt || "—" })}
        actions={
          <>
            <Button variant="portal-secondary" className={HEAD_BTN} disabled={loading || pending} onClick={reload}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
              {t("refresh")}
            </Button>
            {isSuperAdmin ? (
              <Button
                variant="portal-secondary"
                className={HEAD_BTN}
                onClick={() => setConfigModalOpen(true)}
              >
                <Sliders className="size-4" aria-hidden />
                {t("customize.title")}
              </Button>
            ) : null}
            <Button
              variant="portal-secondary"
              className={HEAD_BTN}
              onClick={() => {
                setOutlookKey("pendingApproval");
                leavePlannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {t("leaveRequests")}
            </Button>
            <Button variant="portal" className={HEAD_BTN} render={<Link href={employeesHref} />}>
              {t("viewAllRiders")}
            </Button>
          </>
        }
      />

      <V2Card className="mt-5 p-4 xl:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.8fr)_repeat(6,minmax(0,1fr))]">
          <div className="min-w-0">
            <p className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">{t("projectLabel")}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {readOnly ? null : (
                <ProjectPill
                  active={!projectKey}
                  label={`${t("allProjects")} ${projectTotals.assigned}`}
                  onClick={() => setProjectKey(undefined)}
                />
              )}
              {projects.map((project) => (
                <ProjectPill
                  key={project.key}
                  active={projectKey === project.key}
                  label={`${projectName(project.key, t)} ${project.assigned}`}
                  onClick={() => {
                    if (!readOnly) setProjectKey(project.key);
                  }}
                />
              ))}
            </div>
          </div>

          <FilterField label={t("dateLabel")}>
            <Select items={periodItems} value={period} onValueChange={(value) => setPeriod(value as DashboardPeriod)}>
              <SelectTrigger className={SELECT} aria-label={t("dateLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodItems.map((item) => (
                  <SelectItem key={String(item.value)} value={String(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t("zoneLabel")}>
            <Select items={zoneItems} value={zoneId || "all"} onValueChange={(value) => setZoneId(!value || value === "all" ? "" : value)}>
              <SelectTrigger className={SELECT} aria-label={t("zoneLabel")}>
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
          </FilterField>

          <FilterField label="Nationality Category">
            <Select
              items={natCategoryItems}
              value={nationalityCategory || "all"}
              onValueChange={(value) => setNationalityCategory(!value || value === "all" ? "" : value)}
            >
              <SelectTrigger className={SELECT} aria-label="Nationality Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {natCategoryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Nationality Country">
            <Select
              items={natCountryItems}
              value={nationalityCountry || "all"}
              onValueChange={(value) => setNationalityCountry(!value || value === "all" ? "" : value)}
            >
              <SelectTrigger className={SELECT} aria-label="Nationality Country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {natCountryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t("supervisorLabel")}>
            <Select items={selectOptions([{ value: "all", label: t("allSupervisors") }])} value="all" disabled>
              <SelectTrigger className={SELECT} aria-label={t("supervisorLabel")} title={t("comingSoon")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allSupervisors")}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label={t("vehicleLabel")}>
            <Select items={vehicleItems} value={vehicle || "all"} onValueChange={(value) => setVehicle(!value || value === "all" ? "" : value)}>
              <SelectTrigger className={SELECT} aria-label={t("vehicleLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vehicleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </V2Card>

      {failed ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--status-absent-bg)] px-3 py-2 text-sm text-[var(--status-absent-fg)]">
          <Info className="size-4" aria-hidden />
          {t("loadFailed")}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={reload}>
            {t("retry")}
          </button>
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 [&>div]:px-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard
          layout="portal"
          portalAccent="ink"
          label={t("kpiTotal")}
          value={kpis?.assigned ?? 0}
          caption={t("captionProjects", { count: activeProjects })}
          selected={rosterView === "all"}
          onClick={() => openRoster("all")}
        />
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiWorking")}
          value={kpis?.working ?? 0}
          caption={t("captionWorkingRate", { pct: formatPct(kpis?.workingRate ?? 0) })}
          selected={rosterView === "working"}
          onClick={() => openRoster("working")}
        />
        <KpiCard
          layout="portal"
          portalAccent="blue"
          label={t("kpiOnLeave")}
          value={kpis?.onLeave ?? 0}
          caption={t("captionReturning", { count: data?.outlook.returningThisWeek.length ?? 0 })}
          selected={rosterView === "onLeave"}
          onClick={() => openRoster("onLeave")}
        />
        <KpiCard
          layout="portal"
          portalAccent="ochre"
          label={t("kpiSick")}
          value={kpis?.sick ?? 0}
          caption={t("captionPctOfRiders", { pct: formatPct(rateOf(kpis?.sick ?? 0, kpis?.assigned ?? 0)) })}
          selected={rosterView === "sick"}
          onClick={() => openRoster("sick")}
        />
        <KpiCard
          layout="portal"
          portalAccent="red"
          label={t("kpiAbsent")}
          value={kpis?.absent ?? 0}
          caption={t("captionAttendancePending")}
          selected={rosterView === "absent"}
          onClick={() => openRoster("absent")}
        />
        <KpiCard
          layout="portal"
          portalAccent="grey"
          label={t("kpiNotMarked")}
          value={kpis?.other ?? 0}
          caption={t("captionAttendancePending")}
          selected={rosterView === "other"}
          onClick={() => openRoster("other")}
        />
        <KpiCard
          layout="portal"
          portalAccent="plum"
          label={t("kpiAccident")}
          value={accidentCount}
          caption={accidentCount > 0 ? t("captionIncidents", { count: accidentCount }) : t("captionNoIncidents")}
          selected={rosterView === "accident"}
          onClick={() => openRoster("accident")}
        />
      </div>

      <V2Card className="mt-4 p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[17px] font-bold leading-6 text-[var(--text-primary)]">{t("statusMixTitle")}</h2>
          <p className="text-xs text-[var(--text-secondary)]">{t("ridersCount", { count: mixTotal })}</p>
        </div>
        {mixTotal === 0 ? (
          <V2Empty>{t("noData")}</V2Empty>
        ) : (
          <>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
              {mixRows.map((row) => (
                <div
                  key={row.key}
                  className={TONE_FILL[STATUS_TONES[row.key] ?? "neutral"]}
                  style={{ width: `${(row.count / mixTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {mixRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => openRoster(row.key as RosterView)}
                  aria-pressed={rosterView === row.key}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-subtle)] ${
                    rosterView === row.key ? "bg-[var(--surface-subtle)] font-semibold" : ""
                  }`}
                >
                  <span className={`size-2 rounded-[2px] ${TONE_FILL[STATUS_TONES[row.key] ?? "neutral"]}`} aria-hidden />
                  {statusLabel(row.key, t)}{" "}
                  <span className="font-semibold text-[var(--text-primary)]">{row.count}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </V2Card>

      {rosterView ? (
        <V2Card className="mt-4 p-4 xl:p-5">
          <div ref={rosterRef} className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-bold leading-6 text-[var(--text-primary)]">
                {t("allRiders")}{" "}
                <span className="font-normal text-[var(--text-secondary)]">— {rosterProjectLabel}</span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">{rosterSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="portal-secondary"
                className={HEAD_BTN}
                onClick={exportRoster}
                disabled={rosterStatusRows.length === 0}
              >
                <Download className="size-4" aria-hidden />
                {t("rosterExport")}
              </Button>
              <Button variant="portal-secondary" className={HEAD_BTN} onClick={() => setRosterView(null)}>
                {t("rosterClose")}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-[var(--text-muted)]"
                aria-hidden
              />
              <Input
                value={rosterQuery}
                onChange={(event) => setRosterQuery(event.target.value)}
                placeholder={t("rosterSearch")}
                className="h-9 border-[var(--border-default)] bg-[var(--surface-card)] ps-8"
              />
            </div>
            <Select value={rosterProject} onValueChange={(value) => setRosterProject(value ?? "all")}>
              <SelectTrigger className={`${SELECT} w-44`} aria-label={t("projectLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allProjects")}</SelectItem>
                <SelectItem value="keeta">{t("projectKeeta")}</SelectItem>
                <SelectItem value="americana">{t("projectAmericana")}</SelectItem>
                <SelectItem value="unassigned">{t("projectUnassigned")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="ms-auto text-xs tabular-nums text-[var(--text-secondary)]">
              {rosterRows.length} / {rosterStatusRows.length}
            </p>
            <AppTableColumnPicker
              options={rosterColumnVisibility.pickerOptions}
              isVisible={rosterColumnVisibility.isVisible}
              onToggle={rosterColumnVisibility.toggle}
              onReset={rosterColumnVisibility.reset}
              onMove={rosterColumnVisibility.move}
              onReorder={rosterColumnVisibility.reorder}
              hiddenCount={rosterColumnVisibility.hiddenToggleableCount}
            />
          </div>

          {rosterRows.length === 0 ? (
            <V2Empty>{t("rosterEmpty")}</V2Empty>
          ) : (
            <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-[var(--border-default)]">
              <Table className={TABLE}>
                <TableHeader>
                  <TableRow>
                    {rosterVisibleColumns.map((column) => (
                      <TableHead key={column.id} className={column.headClassName ?? TH}>
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rosterRows.map((row, index) => (
                    <TableRow key={`${row.employeeId}-${index}`}>
                      {rosterVisibleColumns.map((column) => (
                        <TableCell key={column.id} className={column.cellClassName}>
                          {column.render(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
            {t("rosterFoot", { shown: rosterRows.length, total: rosterStatusRows.length })}
          </p>
        </V2Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <V2Card className="p-4 xl:p-5 lg:col-span-2">
          <V2CardHeader
            title={t("projectsTitle")}
            subtitle={t("projectsSubtitle")}
            actions={
              <Button variant="portal-secondary" className={HEAD_BTN} onClick={exportProjects} disabled={projects.length === 0}>
                <Download className="size-4" aria-hidden />
                {t("export")}
              </Button>
            }
          />
          <V2TableShell className="mt-4">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colProject")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colTotal")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colWorking")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colOnLeave")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colSick")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colAbsent")}</TableHead>
                  <TableHead className={`${TH} text-center`}>{t("colNotMarked")}</TableHead>
                  <TableHead className={TH}>{t("colWorkingRate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-[var(--text-secondary)]">
                      {t("noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{projectName(row.key, t)}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.assigned}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.working}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.onLeave}</TableCell>
                      <TableCell className="text-center tabular-nums text-[var(--status-sick-fg)]">{row.sick}</TableCell>
                      <TableCell className="text-center tabular-nums text-[var(--status-absent-fg)]">{row.absent}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.other}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                            <span
                              className="block h-full rounded-full bg-[var(--selected-navy)]"
                              style={{ width: `${Math.min(100, rateOf(row.working, row.assigned))}%` }}
                            />
                          </span>
                          <span className="tabular-nums text-[var(--text-secondary)]">
                            {formatPct(rateOf(row.working, row.assigned))}
                          </span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {projects.length > 0 ? (
                  <TableRow className="bg-[var(--surface-subtle)] font-semibold">
                    <TableCell>{t("allProjects")}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.assigned}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.working}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.onLeave}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.sick}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.absent}</TableCell>
                    <TableCell className="text-center tabular-nums">{projectTotals.other}</TableCell>
                    <TableCell>{formatPct(rateOf(projectTotals.working, projectTotals.assigned))}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </V2TableShell>
          <div className="mt-4">
            <V2Note>{t("notMarkedNote")}</V2Note>
          </div>
        </V2Card>

        <V2Card className="p-4 xl:p-5">
          <V2CardHeader title={t("leaveOutlookTitle")} subtitle={t("leaveOutlookSubtitle", { range: weekRange })} />
          <ul className="mt-3 divide-y divide-[var(--border-default)]">
            {outlookRows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => setOutlookKey(row.key)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 py-3 text-start transition-colors duration-150 hover:text-[var(--text-primary)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">
                    {outlookLabel(row.key, t)}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {(row.key === "pendingApproval" || row.key === "overdue") && row.count > 0 ? (
                      <span className={`size-1.5 rounded-full ${TONE_FILL[row.tone]}`} aria-hidden />
                    ) : null}
                    <span className="font-display text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
                      {row.count}
                    </span>
                    <ChevronRight className="size-4 text-[var(--text-muted)]" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </V2Card>
      </div>

      <V2Card className="mt-4 p-4 xl:p-5">
        <V2CardHeader
          title={t("contractTitle")}
          subtitle={t("contractSubtitle", { count: employeeTotal })}
          actions={
            <Button variant="portal-secondary" className={HEAD_BTN} render={<Link href={employeesHref} />}>
              {t("viewEmployees")}
            </Button>
          }
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(data?.employeeStatus ?? []).map((tile) => (
            <V2Stat
              key={tile.key}
              tone={EMPLOYEE_TONES[tile.key]}
              label={contractLabel(tile.key, t)}
              value={tile.count}
              caption={t("contractOfRiders", { pct: formatPct(rateOf(tile.count, employeeTotal)) })}
            />
          ))}
        </div>
        <V2TableShell className="mt-4">
          <Table className={TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className={TH}>{t("colProject")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("contractRunning")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("contractExtension")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("contractOnLeave")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("colNew")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("colAbsentMosal")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("colCancelled")}</TableHead>
                <TableHead className={`${TH} text-center`}>{t("colTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusMatrix.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[var(--text-secondary)]">
                    {t("noData")}
                  </TableCell>
                </TableRow>
              ) : (
                statusMatrix.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{projectName(row.key, t)}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.running}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.extension}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.leave}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.new}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.absentFromMosal}</TableCell>
                    <TableCell className="text-center tabular-nums">{row.cancelled}</TableCell>
                    <TableCell className="text-center tabular-nums font-semibold">{row.total}</TableCell>
                  </TableRow>
                ))
              )}
              {statusMatrix.length > 0 ? (
                <TableRow className="bg-[var(--surface-subtle)] font-semibold">
                  <TableCell>{t("allProjects")}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.running}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.extension}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.leave}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.new}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.absentFromMosal}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.cancelled}</TableCell>
                  <TableCell className="text-center tabular-nums">{statusTotals.total}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </V2TableShell>
      </V2Card>

      {/* 5.1, 5.2, 5.3: Operations Hub Nationality Classification & Custom Charts */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Nationality Category Classification */}
        <V2Card className="p-4 xl:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[17px] font-bold text-[var(--text-primary)]">
                Nationality Category Classification
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Riders grouped by regional / demographic category (Asian, Arab, etc.)
              </p>
            </div>
            <span className="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {(data?.byNationalityCategory ?? []).reduce((s, c) => s + c.count, 0)} Total
            </span>
          </div>
          {(data?.byNationalityCategory ?? []).length === 0 ? (
            <V2Empty>{t("noData")}</V2Empty>
          ) : (
            <div className="mt-4 space-y-3">
              {(data?.byNationalityCategory ?? []).map((cat) => {
                const total = (data?.byNationalityCategory ?? []).reduce((s, c) => s + c.count, 0);
                const pct = total > 0 ? (cat.count / total) * 100 : 0;
                return (
                  <div key={cat.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-[var(--text-primary)]">{cat.key || "Not Classified"}</span>
                      <span className="tabular-nums text-[var(--text-secondary)]">
                        {cat.count} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--selected-navy)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </V2Card>

        {/* Nationality Country Classification */}
        <V2Card className="p-4 xl:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[17px] font-bold text-[var(--text-primary)]">
                Nationality Country Classification
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Riders classified by specific citizenship / country of origin
              </p>
            </div>
            <span className="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {(data?.byNationalityCountry ?? []).length} Countries
            </span>
          </div>
          {(data?.byNationalityCountry ?? []).length === 0 ? (
            <V2Empty>{t("noData")}</V2Empty>
          ) : (
            <div className="mt-4 max-h-[260px] space-y-3 overflow-y-auto pr-1">
              {(data?.byNationalityCountry ?? []).slice(0, 10).map((c) => {
                const total = (data?.byNationalityCountry ?? []).reduce((s, row) => s + row.count, 0);
                const pct = total > 0 ? (c.count / total) * 100 : 0;
                return (
                  <div key={c.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-[var(--text-primary)]">{c.key || "Unspecified"}</span>
                      <span className="tabular-nums text-[var(--text-secondary)]">
                        {c.count} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </V2Card>
      </div>

      {/* Dynamic Custom Charts configured centrally by Super Admin */}
      {hubConfig.customCharts.length > 0 ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {hubConfig.customCharts.map((chart) => {
            let chartRows: { key: string; count: number }[] = [];
            if (chart.dimension === "nationalityCategory") {
              chartRows = data?.byNationalityCategory ?? [];
            } else if (chart.dimension === "nationalityCountry") {
              chartRows = (data?.byNationalityCountry ?? []).slice(0, 8);
            } else if (chart.dimension === "status") {
              chartRows = (data?.statusBar ?? []).map((s) => ({ key: statusLabel(s.key, t), count: s.count }));
            } else if (chart.dimension === "project") {
              chartRows = (data?.byProject ?? []).map((p) => ({ key: projectName(p.key, t), count: p.assigned }));
            } else if (chart.dimension === "zone") {
              const zoneMap = new Map<string, number>();
              for (const r of rosterSource) {
                const z = r.zone || "Unassigned";
                zoneMap.set(z, (zoneMap.get(z) ?? 0) + 1);
              }
              chartRows = Array.from(zoneMap.entries()).map(([k, v]) => ({ key: k, count: v }));
            }
            const chartTotal = chartRows.reduce((s, r) => s + r.count, 0);

            return (
              <V2Card key={chart.id} className="p-4 xl:p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {chart.type === "bar" ? (
                      <BarChart2 className="size-4 text-[var(--text-secondary)]" />
                    ) : (
                      <PieChart className="size-4 text-[var(--text-secondary)]" />
                    )}
                    <h3 className="font-display text-[15px] font-bold text-[var(--text-primary)]">
                      {chart.title}
                    </h3>
                  </div>
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    {chartTotal} Total
                  </span>
                </div>
                {chartRows.length === 0 ? (
                  <V2Empty>{t("noData")}</V2Empty>
                ) : (
                  <div className="mt-4 space-y-2.5">
                    {chartRows.map((r) => {
                      const pct = chartTotal > 0 ? (r.count / chartTotal) * 100 : 0;
                      return (
                        <div key={r.key} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span className="truncate text-[var(--text-primary)]">{r.key}</span>
                            <span className="tabular-nums text-[var(--text-secondary)]">
                              {r.count} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </V2Card>
            );
          })}
        </div>
      ) : null}

      <div ref={leavePlannerRef} className="mt-4">
        <V2Card className="p-4 xl:p-5">
          <V2CardHeader
            title={t("leavePlannerTitle")}
            subtitle={t("leavePlannerSubtitle")}
            actions={
              <>
                <Select items={selectOptions([{ value: year, label: year }])} value={year} disabled>
                  <SelectTrigger className={`${SELECT} w-24`} aria-label={t("filterYear")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={year}>{year}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  items={selectOptions([
                    { value: "all", label: t("allLeaveTypes") },
                    ...LEAVE_TYPE_KEYS.map((value) => ({ value, label: leaveTypeLabel(value, t) })),
                  ])}
                  value={leaveType || "all"}
                  onValueChange={(value) => setLeaveType(!value || value === "all" ? "" : value)}
                >
                  <SelectTrigger className={`${SELECT} w-40`} aria-label={t("filterLeaveType")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allLeaveTypes")}</SelectItem>
                    {LEAVE_TYPE_KEYS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {leaveTypeLabel(value, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="portal-secondary" className={HEAD_BTN} disabled={readOnly} onClick={() => setImportOpen(true)}>
                  {t("bulkImport")}
                </Button>
                <Button variant="portal-secondary" className={HEAD_BTN} onClick={exportUpcoming} disabled={shownUpcoming.length === 0}>
                  <Download className="size-4" aria-hidden />
                  {t("export")}
                </Button>
                <Button variant="portal" className={HEAD_BTN} disabled={readOnly} onClick={() => setAddOpen(true)}>
                  {t("addLeave")}
                </Button>
              </>
            }
          />

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <V2Stat
              tone="ink"
              label={t("leaveTotalLabel", { year })}
              value={leaveTaken}
              caption={t("leaveTotalCaption", { month: monthLabel(`${year}-${String(monthsElapsed).padStart(2, "0")}`) })}
            />
            <V2Stat
              tone="ink"
              label={t("leaveBusiestLabel")}
              value={busiest ? monthLabel(busiest.yearMonth) : "—"}
              caption={busiest ? t("leaveBusiestCaption", { count: busiest.count }) : undefined}
            />
            <V2Stat tone="ink" label={t("leaveAverageLabel")} value={monthlyAverage} caption={t("leaveAverageCaption")} />
            <V2Stat tone="ink" label={t("leaveApprovedLabel")} value={approvedUpcoming} caption={t("leaveApprovedCaption")} />
          </div>

          <div className="mt-5">
            {leaveBars.length === 0 ? (
              <V2Empty>{t("noData")}</V2Empty>
            ) : (
              <MonthBars items={leaveBars} height={150} className="gap-2 sm:gap-3" />
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
              {t("legendApprovedUpcoming")}
            </span>
          </div>

          <div className="mt-6 border-t border-[var(--border-default)] pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-[15px] font-bold leading-6 text-[var(--text-primary)]">
                  {t("upcomingLeaveTitle")}
                </h3>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  {t("upcomingLeaveSubtitle", { count: upcoming.length })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ProjectPill
                  active={!planProject}
                  label={`${t("all")} ${upcoming.length}`}
                  onClick={() => setPlanProject("")}
                />
                {[...upcomingByProject.entries()].map(([key, count]) => (
                  <ProjectPill
                    key={key}
                    active={planProject === key}
                    label={`${key === "unassigned" ? t("projectUnassigned") : key === "keeta" ? t("projectKeeta") : key === "americana" ? t("projectAmericana") : key} ${count}`}
                    onClick={() => setPlanProject(key)}
                  />
                ))}
                <AppTableColumnPicker
                  options={upcomingColumnVisibility.pickerOptions}
                  isVisible={upcomingColumnVisibility.isVisible}
                  onToggle={upcomingColumnVisibility.toggle}
                  onReset={upcomingColumnVisibility.reset}
                  onMove={upcomingColumnVisibility.move}
                  onReorder={upcomingColumnVisibility.reorder}
                  hiddenCount={upcomingColumnVisibility.hiddenToggleableCount}
                />
              </div>
            </div>

            <V2TableShell className="mt-3">
              <Table className={TABLE}>
                <TableHeader>
                  <TableRow>
                    {upcomingVisibleColumns.map((column) => (
                      <TableHead key={column.id} className={column.headClassName ?? TH}>
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={upcomingVisibleColumns.length} className="text-center text-[var(--text-secondary)]">
                        {t("emptyUpcoming")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    upcomingRows.map((row) => (
                      <TableRow key={row.id}>
                        {upcomingVisibleColumns.map((column) => (
                          <TableCell key={column.id} className={column.cellClassName}>
                            {column.render(row)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </V2TableShell>

            {shownUpcoming.length > 5 ? (
              <button
                type="button"
                onClick={() => setAllUpcomingOpen((open) => !open)}
                className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[var(--accent-rust)]"
              >
                {t("viewAllUpcoming", { count: shownUpcoming.length })}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </V2Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <V2Card className="p-4 xl:p-5">
          <V2CardHeader
            title={t("contractEndTitle")}
            subtitle={t("contractEndSubtitle")}
            actions={
              <>
                <Select items={selectOptions([{ value: "next6", label: t("next6Months") }])} value="next6" disabled>
                  <SelectTrigger className={`${SELECT} w-40`} aria-label={t("next6Months")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="next6">{t("next6Months")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="portal-secondary" className={HEAD_BTN} onClick={exportJobEnd} disabled={jobMatrix.length === 0}>
                  <Download className="size-4" aria-hidden />
                  {t("export")}
                </Button>
              </>
            }
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {contractCards.map((card) => (
              <V2Stat key={card.key} tone="ochre" label={card.label} value={data?.jobEndCards[card.key] ?? 0} />
            ))}
          </div>
          <div className="mt-5">
            {jobBars.length === 0 ? <V2Empty>{t("noData")}</V2Empty> : <MonthBars items={jobBars} height={120} />}
          </div>
          <V2TableShell className="mt-4">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colProject")}</TableHead>
                  {jobMonths.map((bar) => (
                    <TableHead key={bar.yearMonth} className={`${TH} text-center`}>
                      {monthLabel(bar.yearMonth)}
                    </TableHead>
                  ))}
                  <TableHead className={`${TH} text-center`}>{t("colTotal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobMatrix.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={jobMonths.length + 2} className="text-center text-[var(--text-secondary)]">
                      {t("noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  jobMatrix.map((row) => (
                    <TableRow key={row.project}>
                      <TableCell className="font-medium">{projectName(row.project, t)}</TableCell>
                      {jobMonths.map((bar) => (
                        <TableCell key={bar.yearMonth} className="text-center tabular-nums">
                          {row.counts[bar.yearMonth] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell className="text-center tabular-nums font-semibold">{row.total}</TableCell>
                    </TableRow>
                  ))
                )}
                {jobMatrix.length > 0 ? (
                  <TableRow className="bg-[var(--surface-subtle)] font-semibold">
                    <TableCell>{t("allProjects")}</TableCell>
                    {jobMonthTotals.map((total, index) => (
                      <TableCell key={jobMonths[index]?.yearMonth ?? index} className="text-center tabular-nums">
                        {total}
                      </TableCell>
                    ))}
                    <TableCell className="text-center tabular-nums">
                      {jobMonthTotals.reduce((sum, value) => sum + value, 0)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </V2TableShell>
        </V2Card>

        <V2Card className="p-4 xl:p-5">
          <V2CardHeader
            title={t("onLeaveTitle", { count: away.length })}
            actions={
              <>
                {away.length > 6 ? (
                  <Button variant="portal-secondary" className={HEAD_BTN} onClick={() => setAllAwayOpen((open) => !open)}>
                    {t("viewAll")}
                  </Button>
                ) : null}
                <AppTableColumnPicker
                  options={awayColumnVisibility.pickerOptions}
                  isVisible={awayColumnVisibility.isVisible}
                  onToggle={awayColumnVisibility.toggle}
                  onReset={awayColumnVisibility.reset}
                  onMove={awayColumnVisibility.move}
                  onReorder={awayColumnVisibility.reorder}
                  hiddenCount={awayColumnVisibility.hiddenToggleableCount}
                />
              </>
            }
          />
          <V2TableShell className="mt-3">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  {awayVisibleColumns.map((column) => (
                    <TableHead key={column.id} className={column.headClassName ?? TH}>
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {awayRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={awayVisibleColumns.length} className="text-center text-[var(--text-secondary)]">
                      {t("noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  awayRows.map((row, index) => (
                    <TableRow key={`${row.employeeId}-${index}`}>
                      {awayVisibleColumns.map((column) => (
                        <TableCell key={column.id} className={column.cellClassName}>
                          {column.render(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
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
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--status-absent-fg)]" aria-hidden />
              {tBase("outlookOverdue")}
            </span>
          </div>
        </V2Card>
      </div>

      <Dialog
        open={outlookKey != null}
        onOpenChange={(open) => {
          if (!open) setOutlookKey(null);
        }}
      >
        <DialogContent closeOutside showCloseButton className="w-[min(760px,94vw)] max-w-none">
          <div className="max-h-[60dvh] overflow-auto px-5 pt-4">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colName")}</TableHead>
                  <TableHead className={TH}>{t("colProject")}</TableHead>
                  <TableHead className={TH}>{t("colLeaveType")}</TableHead>
                  <TableHead className={TH}>{t("colStart")}</TableHead>
                  <TableHead className={TH}>{t("colEnd")}</TableHead>
                  <TableHead className={TH}>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(outlookKey ? data?.outlook[outlookKey] ?? [] : []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-[var(--text-secondary)]">
                      {t("noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  (outlookKey ? data?.outlook[outlookKey] ?? [] : []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{projectName(row.project, t)}</TableCell>
                      <TableCell>{leaveTypeLabel(row.leaveType, t)}</TableCell>
                      <TableCell className="tabular-nums">{formatKuwaitDateLabel(row.start)}</TableCell>
                      <TableCell className="tabular-nums">{formatKuwaitDateLabel(row.end)}</TableCell>
                      <TableCell>{planStatusLabel(row.status, t)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="px-5 pb-4">
            <AppModalFooter title={outlookKey ? outlookLabel(outlookKey, t) : t("leaveOutlookTitle")} subtitle={weekRange}>
              <Button variant="portal-neutral" className={HEAD_BTN} onClick={() => setOutlookKey(null)}>
                {t("cancel")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AddLeaveDialog open={addOpen} onOpenChange={setAddOpen} onSaved={reload} />
      <ImportLeaveDialog open={importOpen} onOpenChange={setImportOpen} onImported={reload} />
      {isSuperAdmin ? (
        <CustomColumnsDialog
          key={configModalOpen ? "custom-columns-open" : "custom-columns-closed"}
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          config={hubConfig}
          onSave={handleSaveHubConfig}
        />
      ) : null}
    </V2Surface>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">{label}</p>
      {children}
    </div>
  );
}

function ProjectPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "inline-flex h-9 cursor-pointer items-center rounded-lg bg-[var(--selected-navy)] px-3 text-[13px] font-medium text-white"
          : "inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-[13px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-subtle)]"
      }
    >
      {label}
    </button>
  );
}

function projectName(project: string, t: Translator): string {
  if (!project || project === "unassigned") return t("projectUnassigned");
  if (project === "keeta") return t("projectKeeta");
  if (project === "americana") return t("projectAmericana");
  return project;
}

function backState(end: string, today: string, todayLabel: string, overdueLabel: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return {
      label: "—",
      className: "bg-[var(--status-neutral-bg)] text-[var(--text-secondary)]",
      dot: "bg-[var(--status-neutral-fg)]",
    };
  }
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) {
    return {
      label: `${overdueLabel} · ${formatKuwaitDateLabel(end)}`,
      className: "bg-[var(--status-absent-bg)] text-[var(--status-absent-fg)]",
      dot: "bg-[var(--status-absent-fg)]",
    };
  }
  if (days === 0) {
    return {
      label: todayLabel,
      className: "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]",
      dot: "bg-[var(--status-working-fg)]",
    };
  }
  if (days <= 3) {
    return {
      label: formatKuwaitDateLabel(end),
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

function AddLeaveDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.operationsDashboardV2");
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [start, setStart] = useState(kuwaitTodayYmd());
  const [end, setEnd] = useState(kuwaitTodayYmd());
  const [status, setStatus] = useState("pending");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await upsertLeavePlan({
      employee_id: employeeId.trim(),
      leave_type: leaveType,
      start_date: start,
      end_date: end,
      status,
    });
    setSaving(false);
    if (result.error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    setEmployeeId("");
    onOpenChange(false);
    onSaved();
  }

  const typeItems = selectOptions(LEAVE_TYPE_KEYS.map((value) => ({ value, label: leaveTypeLabel(value, t) })));
  const statusItems = selectOptions(PLAN_STATUSES.map((value) => ({ value, label: planStatusLabel(value, t) })));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOutside showCloseButton className="w-[min(560px,94vw)] max-w-none">
        <div className="space-y-3 px-5 pt-4">
          <label className="block space-y-1 text-xs">
            <span>{t("employeeId")}</span>
            <Input
              className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>{t("leaveType")}</span>
            <Select items={typeItems} value={leaveType} onValueChange={(value) => { if (value) setLeaveType(value); }}>
              <SelectTrigger className={SELECT}>
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
              <Input
                className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]"
                type="date"
                openPickerOnFocus={false}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span>{t("endDate")}</span>
              <Input
                className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]"
                type="date"
                openPickerOnFocus={false}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span>{t("status")}</span>
            <Select items={statusItems} value={status} onValueChange={(value) => { if (value) setStatus(value); }}>
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
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
            <Button variant="portal-neutral" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="portal"
              className="h-9 cursor-pointer"
              disabled={saving || !employeeId.trim() || !start || !end}
              onClick={() => void save()}
            >
              {saving ? t("saving") : t("save")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportLeaveDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const t = useTranslations("pages.operationsDashboardV2");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);

  async function run() {
    setSaving(true);
    const result = await importLeavePlans(csv);
    setSaving(false);
    if (result.error === "empty_csv") {
      toast.error(t("emptyCsv"));
      return;
    }
    if (result.error === "invalid_csv") {
      toast.error(t("invalidCsv"));
      return;
    }
    if (result.error === "partial") {
      toast.warning(t("importPartial", { imported: result.imported ?? 0, failed: result.failed ?? 0 }));
    } else if (result.error) {
      toast.error(t("importFailed"));
      return;
    } else {
      toast.success(t("imported", { count: result.imported ?? 0 }));
    }
    setCsv("");
    setFileName("");
    onOpenChange(false);
    onImported();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOutside showCloseButton className="w-[min(560px,94vw)] max-w-none">
        <div className="space-y-3 px-5 pt-4">
          <label className="block space-y-1 text-xs">
            <span>{t("bulkImportTitle")}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block w-full cursor-pointer rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                void file.text().then(setCsv);
              }}
            />
            <span className="block text-[var(--text-secondary)]">{t("bulkImportSubtitle")}</span>
            {fileName ? <span className="block font-medium">{fileName}</span> : null}
          </label>
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter title={t("bulkImportTitle")} subtitle={t("bulkImportSubtitle")}>
            <Button variant="portal-neutral" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button variant="portal" className="h-9 cursor-pointer" disabled={saving || !csv} onClick={() => void run()}>
              {saving ? t("importing") : t("importCsv")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
