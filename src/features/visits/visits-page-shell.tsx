"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppListToolbar } from "@/components/app/app-list-toolbar";
import {
  DATE_RANGE_ALL,
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/app/date-range-filter";
import { SortableTableHeadLabel } from "@/components/app/sortable-table-head-label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions, selectOptionsFrom } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitsList,
  fetchVisitBranches,
  fetchVisitDepartments,
  updateAdminVisitStatus,
  type VisitListRow,
} from "./visits-actions";
import {
  avatarTintClass,
  departmentBadgeClass,
  initialsOf,
  visitStatusVariant,
} from "./visit-status-utils";

type DataTab = "all" | "today" | "upcoming" | "past";

const STATUS_KEYS = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

function isoDate(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

/** `2026-08-12` -> `12 Aug` (Figma column format). */
function shortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function statusDotClass(variant: ReturnType<typeof visitStatusVariant>): string {
  if (variant === "success") return "bg-success";
  if (variant === "warning") return "bg-warning";
  if (variant === "danger") return "bg-danger";
  return "bg-muted-foreground";
}

function statusTextClass(variant: ReturnType<typeof visitStatusVariant>): string {
  if (variant === "success") return "text-success";
  if (variant === "warning") return "text-warning";
  if (variant === "danger") return "text-danger";
  return "text-muted-foreground";
}

function toCsv(rows: VisitListRow[]): string {
  const header = [
    "Booking",
    "Rider",
    "Phone",
    "Branch",
    "Department",
    "Status",
    "Slot",
    "Date",
  ];
  const lines = rows.map((r) =>
    [
      r.booking_code,
      r.driver_name,
      r.driver_phone ?? "",
      r.branch_name ?? "",
      r.department_label,
      r.status,
      r.slot_start ? r.slot_start.slice(0, 5) : "",
      r.scheduled_date,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function VisitsPageShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<DataTab>("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>(DATE_RANGE_ALL);
  const [branchFilter, setBranchFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | false>(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list({ dateRange }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: isoDate(dateRange.from),
        dateTo: isoDate(dateRange.to),
        limit: 200,
      }),
  });

  const { data: branchesData } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: fetchVisitBranches,
  });
  const { data: deptData } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: fetchVisitDepartments,
  });

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const kpi = data?.kpi;
  const today = new Date().toISOString().slice(0, 10);

  const tabRows = useMemo(() => {
    if (tab === "today") return rows.filter((r) => r.scheduled_date === today);
    if (tab === "upcoming") return rows.filter((r) => r.scheduled_date > today);
    if (tab === "past") return rows.filter((r) => r.scheduled_date < today);
    return rows;
  }, [rows, tab, today]);

  const visibleRows = useMemo(() => {
    let list = tabRows;
    if (branchFilter !== "all") list = list.filter((r) => r.branch_id === branchFilter);
    if (deptFilter !== "all") list = list.filter((r) => r.department_key === deptFilter);
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.booking_code.toLowerCase().includes(q) ||
          r.driver_name.toLowerCase().includes(q) ||
          r.driver_code.toLowerCase().includes(q),
      );
    }
    if (sortDir) {
      list = [...list].sort((a, b) =>
        sortDir === "asc"
          ? a.booking_code.localeCompare(b.booking_code)
          : b.booking_code.localeCompare(a.booking_code),
      );
    }
    return list;
  }, [tabRows, branchFilter, deptFilter, statusFilter, search, sortDir]);

  const setStatus = async (
    bookingId: string,
    status: "checked_in" | "completed" | "no_show" | "cancelled",
  ) => {
    setBusyId(bookingId);
    const result = await updateAdminVisitStatus({ bookingId, status });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("actionFailed"));
      return;
    }
    toast.success(t("actionOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  const exportCsv = () => {
    const csv = toCsv(visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `visit-bookings-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pastCount = useMemo(
    () => rows.filter((r) => r.scheduled_date < today).length,
    [rows, today],
  );

  const TABS: { id: DataTab; label: string; count?: number }[] = [
    { id: "all", label: t("allVisits.tabAll"), count: rows.length },
    { id: "today", label: t("allVisits.tabToday"), count: kpi?.today },
    { id: "upcoming", label: t("allVisits.tabUpcoming"), count: kpi?.upcoming },
    { id: "past", label: t("allVisits.tabPast"), count: pastCount },
  ];

  const branchItems = useMemo(
    () => [
      { value: "all", label: t("allVisits.filterAllBranches") },
      ...selectOptionsFrom(
        branchesData?.rows ?? [],
        (b) => b.id,
        (b) => b.name,
      ),
    ],
    [branchesData?.rows, t],
  );
  const deptItems = useMemo(
    () => [
      { value: "all", label: t("allVisits.filterAllDepartments") },
      ...selectOptionsFrom(
        deptData?.rows ?? [],
        (d) => d.key,
        (d) => d.label_en,
      ),
    ],
    [deptData?.rows, t],
  );
  const statusItems = useMemo(
    () =>
      selectOptions([
        { value: "all", label: t("allVisits.filterAllStatus") },
        ...STATUS_KEYS.map((s) => ({
          value: s,
          label: t(`status.${s}` as "status.confirmed"),
        })),
      ]),
    [t],
  );

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("allVisits.title") },
        ]}
        title={t("allVisits.title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={exportCsv}
            >
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("allVisits.export")}
            </Button>
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/visit-bookings/calendar" />}>
              <CalendarDays className="me-1.5 h-3.5 w-3.5" />
              {t("nav.calendar")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile
          icon={<FileText className="h-3.5 w-3.5" />}
          iconClass="bg-primary/10 text-primary"
          label={t("kpi.today")}
          value={kpi?.today ?? "—"}
          sub={t("allVisits.kpiTodaySub", { count: kpi?.today_checked_in ?? 0 })}
        />
        <KpiTile
          icon={<Clock className="h-3.5 w-3.5" />}
          iconClass="bg-warning/10 text-warning"
          label={t("kpi.upcoming")}
          value={kpi?.upcoming ?? "—"}
          sub={t("allVisits.kpiUpcomingSub")}
        />
        <KpiTile
          icon={<Activity className="h-3.5 w-3.5" />}
          iconClass="bg-primary/10 text-primary"
          label={t("kpi.awaitingCheckin")}
          value={kpi?.awaiting_checkin ?? "—"}
          sub={t("allVisits.kpiAwaitingSub")}
          accent="warning"
        />
        <KpiTile
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          iconClass="bg-danger/10 text-danger"
          label={t("kpi.noShows")}
          value={kpi?.no_shows ?? "—"}
          sub={t("allVisits.kpiNoShowsSub")}
          accent="danger"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-0">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <AppListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("allVisits.searchPlaceholder")}
        countLabel={t("allVisits.countLabel", {
          shown: visibleRows.length,
          total: tabRows.length,
        })}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={branchItems}
              value={branchFilter}
              onValueChange={(v) => v && setBranchFilter(v)}
            >
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branchItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={deptItems}
              value={deptFilter}
              onValueChange={(v) => v && setDeptFilter(v)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deptItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={statusItems}
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v)}
            >
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          </div>
        }
      />

      <AppListCard className="mt-2 p-0">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleRows.length === 0 ? (
          <AppEmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              {
                id: "code",
                label: (
                  <SortableTableHeadLabel
                    label={t("allVisits.colVisId")}
                    direction={sortDir}
                    onSort={() =>
                      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? false : "asc"))
                    }
                  />
                ),
              },
              { id: "driver", label: t("colDriver") },
              { id: "branch", label: t("colBranch") },
              { id: "dept", label: t("colDepartment") },
              { id: "status", label: t("colStatus") },
              { id: "time", label: t("allVisits.colSlot") },
              { id: "date", label: t("colDate") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {visibleRows.map((row) => {
              const variant = visitStatusVariant(row.status);
              return (
                <AppDataTableRow key={row.id}>
                  <TableCell className="font-medium tabular-nums">
                    <Link
                      href={`/visit-bookings/${row.id}`}
                      className="text-primary hover:underline"
                    >
                      {row.booking_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                          avatarTintClass(row.driver_name),
                        )}
                      >
                        {initialsOf(row.driver_name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.driver_name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {row.driver_phone ?? row.driver_code}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.branch_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        departmentBadgeClass(row.department_key),
                      )}
                    >
                      {row.department_label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", statusTextClass(variant))}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(variant))} />
                      {t(`status.${row.status}` as "status.confirmed")}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {row.slot_start ? row.slot_start.slice(0, 5) : "—"}
                    {row.slot_end ? `–${row.slot_end.slice(0, 5)}` : ""}
                  </TableCell>
                  <TableCell
                    className="text-sm tabular-nums"
                    title={row.scheduled_date}
                  >
                    {shortDate(row.scheduled_date)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/visit-bookings/${row.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      {canOperate && row.status === "confirmed" ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            disabled={busyId === row.id}
                            onClick={() => void setStatus(row.id, "checked_in")}
                          >
                            {t("checkIn")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-destructive hover:bg-destructive/10"
                            disabled={busyId === row.id}
                            onClick={() => void setStatus(row.id, "cancelled")}
                          >
                            {t("cancel")}
                          </Button>
                        </>
                      ) : canOperate && row.status === "checked_in" ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={busyId === row.id}
                          onClick={() => void setStatus(row.id, "completed")}
                        >
                          {t("complete")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </AppDataTableRow>
              );
            })}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}

function KpiTile({
  icon,
  iconClass,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  sub: string;
  accent?: "warning" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn("flex h-6 w-6 items-center justify-center rounded-md", iconClass)}
        >
          {icon}
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[11px]",
          accent === "warning" && "text-warning",
          accent === "danger" && "text-danger",
          !accent && "text-muted-foreground",
        )}
      >
        {sub}
      </p>
    </div>
  );
}
