"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarDays,
  Check,
  Clock,
  Download,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Timer,
  TriangleAlert,
  X,
} from "lucide-react";
import { AppEmptyState, AppListCard, AppPage } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { useZonesList } from "@/features/zones/use-zones";
import { useAuth } from "@/contexts/auth-context";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { FleetRequestDialog } from "@/features/fuel/fleet-request-dialog";
import { RequestCreateDialog } from "./request-create-dialog";
import {
  canBulkSelectRequest,
  normalizeStatusFilter,
  requestStatusLabelKey,
  requestStatusVariant,
  statusFiltersForRequestType,
  type RequestStatusFilter,
} from "./request-status-utils";
import { parseRequestDatePreset, REQUEST_DATE_PRESETS } from "./date-presets";
import { listScopeFlags, type RequestListScope } from "./request-list-scopes";
import { DECISION_TERM_TYPES, type RequestDatePreset, type RequestListRow } from "./types";
import { useAdminRequestsList, useBulkDecideRequests } from "./use-requests";

function formatAvgDays(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  return `${(seconds / 86400).toFixed(1)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Server-side page size. The list RPC already honoured `p_limit` / `p_offset`
 * but the shell pinned both to `50 / 0`, so a queue with 300 rows could only
 * ever show its newest 50 with no way to reach the rest. The same value is the
 * page stride here, so "Showing 50 of 300" and the footer cannot disagree.
 */
const PAGE_SIZE = 50;

/** "12 Jul" — built from parts so the day stays first regardless of runtime locale. */
function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Trend caption vs previous month (locked KPI rule). `lowerIsBetter` flips the tone. */
function trendCaption(
  current: number,
  previous: number | null,
  lowerIsBetter: boolean,
  t: (key: string, values?: Record<string, string>) => string,
) {
  if (previous == null) return null;
  const delta = current - previous;
  if (delta === 0) {
    return <span className="text-muted-foreground">{t("kpi.trendFlat")}</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5",
        improved ? "text-success" : "text-danger",
      )}
    >
      <Icon className="h-3 w-3" />
      {t("kpi.trendDelta", { delta: `${Math.abs(delta)}` })}
    </span>
  );
}

const TYPE_FILTERS = [
  "all",
  "leave",
  "sick_leave",
  "loan",
  "asset",
  "fuel",
  "fuel_refund",
  "document",
  "complaint",
  "salary_justification",
] as const;

/** Normalise any `?type=` value onto the filter list, defaulting to All. */
function normalizeTypeFilter(value: string | undefined): string {
  return TYPE_FILTERS.includes(value as (typeof TYPE_FILTERS)[number])
    ? (value as string)
    : "all";
}

/**
 * Loan, asset and sick-leave approvals must capture terms (amount, tenure, penalty, document)
 * on the final step, which only the detail page can do — so they are never bulk approved.
 */
function canBulkApprove(row: RequestListRow): boolean {
  return (
    canBulkSelectRequest(row.status) &&
    !(DECISION_TERM_TYPES as readonly string[]).includes(row.request_type)
  );
}

/** Only the rows currently on screen are exported, matching what the admin can see. */
function exportRowsToCsv(rows: RequestListRow[], fileName: string) {
  const header = [
    "Request code",
    "Rider",
    "Rider code",
    "Zone",
    "Type",
    "Department",
    "Status",
    "Current step",
    "Submitted",
  ];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const body = rows.map((row) =>
    [
      row.request_code,
      row.driver_name,
      row.driver_code,
      row.driver_zone ?? "",
      row.request_type,
      row.department_label ?? "",
      row.status,
      row.current_step_label ?? "",
      row.created_at,
    ]
      .map((cell) => escape(String(cell ?? "")))
      .join(","),
  );
  const blob = new Blob([[header.map(escape).join(","), ...body].join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function RequestsPageShell({
  initialType = "all",
  initialDatePreset,
  initialStatus = "all",
  listScope,
  scopeTabs = false,
}: {
  initialType?: string;
  initialDatePreset?: string;
  listScope?: RequestListScope;
  scopeTabs?: boolean;
  /**
   * Which status tab opens selected.
   *
   * Added for the EmployeeDesk tree, where "Incoming" and "Outgoing" are the
   * same list entered through a different door, and the door decides the queue:
   * without this the two routes would render byte-identical pages and the
   * sidebar would be advertising two names for one screen. The value is seeded
   * like the other initial props — a tab the operator clicks afterwards is the
   * operator's choice, not the route's.
   */
  initialStatus?: string;
}) {
  const t = useTranslations("pages.requests");
  const router = useRouter();
  const [datePreset, setDatePreset] = useState<RequestDatePreset>(
    parseRequestDatePreset(initialDatePreset),
  );
  const [type, setType] = useState<string>(normalizeTypeFilter(initialType));
  const [status, setStatus] = useState<RequestStatusFilter>(
    normalizeStatusFilter(initialStatus),
  );
  const [departmentKey, setDepartmentKey] = useState<string>("all");
  const [zoneId, setZoneId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [scope, setScope] = useState<RequestListScope>(listScope ?? (scopeTabs ? "all" : null));
  /**
   * Server-side paging over the list RPC's `p_limit` / `p_offset`.
   *
   * The page index is stored *with the filter signature it belongs to* and read
   * back through it, so a filter change cannot leave the operator on page 4 of a
   * result set that no longer exists. Deriving it beats an effect that calls
   * `setPage(0)`: the URL-mirroring effects below set the same filters, so an
   * effect keyed on them would reset the page twice on every Back/Forward, and
   * setting state from an effect is the cascading-render shape this repo lints
   * against.
   */
  const [pageState, setPageState] = useState({ signature: "", page: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewRow, setViewRow] = useState<RequestListRow | null>(null);

  // The type filter is URL-backed, but the shell only read the URL into
  // `useState` on its first mount. The App Router keeps this page component
  // mounted when the query string changes (browser Back/Forward between two
  // `/requests/overview?type=…` entries), so the previous filter stayed
  // selected — reported as "clicked Leave, landed on the All list". Mirror the
  // prop into state whenever the URL moves.
  useEffect(() => {
    const next = normalizeTypeFilter(initialType);
    setType((current) => (current === next ? current : next));
  }, [initialType]);

  useEffect(() => {
    const next = parseRequestDatePreset(initialDatePreset);
    setDatePreset((current) => (current === next ? current : next));
  }, [initialDatePreset]);

  // Same URL-mirroring reason as the type filter above: two EmployeeDesk routes
  // (`/employeedesk/all` and `/employeedesk/incoming`) render this one shell, and
  // navigating between them changes only the prop. Without this the second route
  // would keep whichever tab the first had selected and the two doors would show
  // the same queue.
  useEffect(() => {
    const next = normalizeStatusFilter(initialStatus);
    setStatus((current) => (current === next ? current : next));
  }, [initialStatus]);

  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const canCreate = can("requests.create");
  const bulkDecide = useBulkDecideRequests();

  // The identity the stored page index is valid for. Any change here makes the
  // index meaningless, so it reads back as page 0 rather than as an empty page.
  const filterSignature = [
    datePreset,
    type,
    status,
    departmentKey,
    zoneId,
    searchApplied,
    scope ?? "",
  ].join("|");
  const page = pageState.signature === filterSignature ? pageState.page : 0;
  const setPage = (next: number | ((current: number) => number)) =>
    setPageState((current) => {
      const base = current.signature === filterSignature ? current.page : 0;
      return {
        signature: filterSignature,
        page: Math.max(0, typeof next === "function" ? next(base) : next),
      };
    });

  const filters = useMemo(
    () => ({
      datePreset,
      type: type === "all" ? null : type,
      status: status === "all" ? null : status,
      departmentKey: departmentKey === "all" ? null : departmentKey,
      zoneId: zoneId === "all" ? null : zoneId,
      search: searchApplied,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...listScopeFlags(scope),
    }),
    [datePreset, type, status, departmentKey, zoneId, searchApplied, page, scope],
  );

  const { data, isLoading, isFetching, refetch } = useAdminRequestsList(filters);
  const { data: zones } = useZonesList();
  const rows = data?.rows ?? [];
  const kpi = data?.kpi;
  const statusCounts = data?.statusCounts ?? {};
  const filteredTotal = data?.filteredTotal ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const departmentOptions = data?.departmentOptions ?? [];

  const visibleStatusFilters = useMemo(
    () => statusFiltersForRequestType(type),
    [type],
  );

  useEffect(() => {
    if (!visibleStatusFilters.includes(status)) setStatus("all");
  }, [status, visibleStatusFilters]);

  const statusTabs = useMemo(
    () =>
      visibleStatusFilters.map((key) => {
        const label =
          key === "all"
            ? t("statusFilter.all")
            : t(`status.${key}` as "status.pending");
        const count =
          key === "all"
            ? Object.values(statusCounts).reduce((sum, n) => sum + n, 0)
            : (statusCounts[key] ?? 0);
        return { id: key, label: `${label} ${count}` };
      }),
    [statusCounts, t, visibleStatusFilters],
  );

  const filtersNarrow =
    datePreset !== "all" ||
    type !== "all" ||
    status !== "all" ||
    departmentKey !== "all" ||
    zoneId !== "all" ||
    searchApplied !== "";

  const selectableRows = rows.filter((row) => canBulkSelectRequest(row.status));
  const showSelectColumn = canDecide;
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const approvableRows = selectedRows.filter(canBulkApprove);

  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) =>
      current.size === selectableRows.length
        ? new Set()
        : new Set(selectableRows.map((row) => row.id)),
    );

  const runBulk = async (action: "approve" | "reject", reason?: string) => {
    const targets = action === "approve" ? approvableRows : selectedRows;
    if (targets.length === 0) return;
    const result = await bulkDecide.mutateAsync({
      requestIds: targets.map((row) => row.id),
      action,
      reason,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.failed.length > 0) {
      toast.warning(
        t("bulk.partial", {
          done: `${result.succeeded.length}`,
          failed: `${result.failed.length}`,
        }),
      );
    } else {
      toast.success(t("bulk.done", { done: `${result.succeeded.length}` }));
    }
    setSelected(new Set());
    setRejectOpen(false);
    setRejectReason("");
  };

  return (
    <AppPage className="space-y-3">
      {/* Figma leads with the breadcrumb only — the page title band is replaced by the
          queue tabs, so the KPI strip and the table both stay above the fold. */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/requests">{t("hub.title")}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {type === "all" ? t("overviewTitle") : t(`types.${type}` as "types.leave")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <KpiGrid
        compact
        items={[
          {
            label: t("kpi.total"),
            value: kpi ? kpi.total : "—",
            icon: Building2,
            caption: kpi ? trendCaption(kpi.total, kpi.prev_total, false, t) : null,
          },
          {
            label: t("kpi.pending"),
            value: kpi ? kpi.pending : "—",
            accent: "warning",
            icon: Clock,
            caption: kpi ? trendCaption(kpi.pending, kpi.prev_pending, true, t) : null,
          },
          {
            label: t("kpi.avgResolution"),
            value: formatAvgDays(kpi?.avg_resolution_seconds ?? null),
            icon: Timer,
            caption:
              kpi?.avg_resolution_seconds != null && kpi.prev_avg_resolution_seconds != null
                ? trendCaption(
                    Number((kpi.avg_resolution_seconds / 86400).toFixed(1)),
                    Number((kpi.prev_avg_resolution_seconds / 86400).toFixed(1)),
                    true,
                    t,
                  )
                : null,
          },
          {
            label: t("kpi.overdue"),
            value: kpi ? kpi.overdue : "—",
            accent: "danger",
            icon: TriangleAlert,
            caption: kpi ? trendCaption(kpi.overdue, kpi.prev_overdue, true, t) : null,
          },
        ]}
      />

      <AppListCard>
        {scopeTabs ? (
          <div className="border-b border-border px-3 py-1">
            <TabBar
              items={[
                { id: "assigned", label: t("scope.waiting") },
                { id: "forwarded", label: t("scope.forwarded") },
                { id: "handled", label: t("scope.handled") },
                { id: "all", label: t("scope.all") },
              ]}
              activeId={scope ?? "all"}
              className="flex-nowrap gap-4 border-b-0 [&>button]:pb-2"
              onSelect={(id) => setScope(id as RequestListScope)}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1">
          {/* Nine data-backed queues do not fit one line next to the actions, so the
              strip scrolls sideways instead of wrapping into a second row. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TabBar
              items={statusTabs}
              activeId={status}
              className="flex-nowrap gap-4 border-b-0 [&>button]:pb-2"
              onSelect={(id) => setStatus(id as RequestStatusFilter)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("refresh")}
              title={t("refresh")}
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={rows.length === 0}
              onClick={() =>
                exportRowsToCsv(rows, `requests-${datePreset}-${Date.now()}.csv`)
              }
            >
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("export")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              render={<Link href="/requests/settings" />}
            >
              <Settings className="me-1.5 h-3.5 w-3.5" />
              {t("settingsLink")}
            </Button>
            <ClearAllModuleButton entity="requests" compact />
            {canCreate ? (
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t("create.button")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Select
            items={TYPE_FILTERS.map((key) => ({
              value: key,
              label: t(`types.${key}`),
            }))}
            value={type}
            onValueChange={(v) => {
              if (v) setType(v);
            }}
          >
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder={t("filters.type")} />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((key) => (
                <SelectItem key={key} value={key} label={t(`types.${key}`)}>
                  {t(`types.${key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={[
              { value: "all", label: t("filters.departmentAll") },
              ...departmentOptions.map((option) => ({
                value: option.key,
                label: option.label,
              })),
            ]}
            value={departmentKey}
            onValueChange={(v) => {
              if (v) setDepartmentKey(v);
            }}
          >
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder={t("filters.department")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filters.departmentAll")}>
                {t("filters.departmentAll")}
              </SelectItem>
              {departmentOptions.map((option) => (
                <SelectItem key={option.key} value={option.key} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={[
              { value: "all", label: t("filters.zoneAll") },
              ...(zones ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
            ]}
            value={zoneId}
            onValueChange={(v) => {
              if (v) setZoneId(v);
            }}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder={t("filters.zone")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filters.zoneAll")}>
                {t("filters.zoneAll")}
              </SelectItem>
              {(zones ?? []).map((zone) => (
                <SelectItem key={zone.id} value={zone.id} label={zone.name}>
                  {zone.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={REQUEST_DATE_PRESETS.map((preset) => ({
              value: preset,
              label: t(`datePresets.${preset}`),
            }))}
            value={datePreset}
            onValueChange={(v) => {
              if (v) setDatePreset(v as RequestDatePreset);
            }}
          >
            <SelectTrigger className="h-9 w-[180px]" aria-label={t("filters.date")}>
              <CalendarDays className="me-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("filters.date")} />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_DATE_PRESETS.map((preset) => (
                <SelectItem
                  key={preset}
                  value={preset}
                  label={t(`datePresets.${preset}`)}
                >
                  {t(`datePresets.${preset}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {t("resultCount", {
              shown: `${rows.length}`,
              total: `${filteredTotal}`,
            })}
          </p>

          <Input
            className="h-9 w-[240px] shrink-0"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setSearchApplied(search.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearchApplied(search.trim());
            }}
          />
        </div>

        {canDecide && selected.size > 0 ? (
          <div className="mx-3 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              {t("bulk.selected", { count: `${selected.size}` })}
              {approvableRows.length !== selectedRows.length ? (
                <span className="ms-2 font-normal text-muted-foreground">
                  {t("bulk.termsExcluded", {
                    count: `${selectedRows.length - approvableRows.length}`,
                  })}
                </span>
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={approvableRows.length === 0 || bulkDecide.isPending}
                onClick={() => void runBulk("approve")}
              >
                <Check className="me-1 h-3.5 w-3.5" />
                {t("bulk.approve", { count: `${approvableRows.length}` })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:bg-destructive/10"
                disabled={bulkDecide.isPending}
                onClick={() => setRejectOpen(true)}
              >
                <X className="me-1 h-3.5 w-3.5" />
                {t("bulk.reject", { count: `${selectedRows.length}` })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setSelected(new Set())}
              >
                {t("bulk.clear")}
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={filtersNarrow ? t("emptyFilteredTitle") : t("emptyTitle")}
            description={
              filtersNarrow ? t("emptyFilteredDescription") : t("emptyDescription")
            }
          />
        ) : (
          <AppDataTable
            columns={[
              ...(showSelectColumn
                ? [
                    {
                      id: "select",
                      className: "w-10",
                      label: (
                        <Checkbox
                          aria-label={t("bulk.selectAll")}
                          checked={
                            selectableRows.length > 0 &&
                            selected.size === selectableRows.length
                          }
                          disabled={selectableRows.length === 0}
                          onCheckedChange={toggleAll}
                        />
                      ),
                    },
                  ]
                : []),
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "type", label: t("colType") },
              { id: "department", label: t("colDepartment") },
              { id: "status", label: t("colStatus") },
              { id: "step", label: t("colStep") },
              { id: "date", label: t("colDate") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className={cn(
                  "cursor-pointer",
                  row.needs_attention && "bg-primary/10",
                )}
                onClick={() => router.push(`/requests/${row.id}`)}
              >
                {showSelectColumn ? (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canBulkSelectRequest(row.status) ? (
                      <Checkbox
                        aria-label={row.request_code}
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                      />
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {row.needs_attention ? (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-primary"
                        title={t("attentionBadge")}
                      />
                    ) : null}
                    <span className="font-medium tabular-nums">{row.request_code}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7 shrink-0 border border-border">
                      <AvatarFallback
                        className={cn(
                          "bg-transparent text-[10px] font-semibold",
                          avatarTintFromName(row.driver_name),
                        )}
                      >
                        {row.driver_name
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0]?.toUpperCase() ?? "")
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium leading-tight">
                        {row.is_confidential ? t("confidential") : row.driver_name}
                      </p>
                      <p className="text-[11px] leading-tight text-muted-foreground tabular-nums">
                        {row.is_confidential ? "—" : row.driver_code || "—"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {t(`types.${row.request_type}` as "types.leave")}
                </TableCell>
                <TableCell>
                  {row.department_label ? (
                    <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {row.department_label}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill
                    variant={requestStatusVariant(row.status, {
                      awaiting_driver_ack: row.awaiting_driver_ack,
                    })}
                  >
                    {t(
                      `status.${requestStatusLabelKey(row.status, {
                        awaiting_driver_ack: row.awaiting_driver_ack,
                      })}` as "status.pending",
                    )}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.current_step_label ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {shortDate(row.created_at)}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-primary hover:bg-primary/10"
                    aria-label={t("viewDetails")}
                    title={t("viewDetails")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewRow(row);
                    }}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}

        {!isLoading && rows.length > 0 && pageCount > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("pageOf", { page: `${page + 1}`, total: `${pageCount}` })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t("prevPage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page + 1 >= pageCount || isFetching}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        ) : null}
      </AppListCard>

      <RequestCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialType={type}
      />

      <FleetRequestDialog
        open={viewRow != null}
        preview={viewRow}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          className="w-[min(520px,96vw)] overflow-visible pt-4"
          showCloseButton
          closeOutside
        >
          <div className="space-y-1 px-5">
            <Label htmlFor="bulk-reject-reason">{t("bulk.reasonLabel")}</Label>
            <Textarea
              id="bulk-reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("bulk.reasonPlaceholder")}
            />
            <p className="text-[10px] text-muted-foreground">
              {t("bulk.reasonHint", { count: `${selectedRows.length}` })}
            </p>
          </div>
          <div className="px-2 pb-2 pt-3">
            <AppModalFooter
              title={t("bulk.rejectTitle")}
              subtitle={t("bulk.rejectSubtitle", { count: `${selectedRows.length}` })}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setRejectOpen(false)}
              >
                {t("bulk.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!rejectReason.trim() || bulkDecide.isPending}
                onClick={() => void runBulk("reject", rejectReason.trim())}
              >
                {bulkDecide.isPending ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="me-1.5 h-3.5 w-3.5" />
                )}
                {t("bulk.confirmReject")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
