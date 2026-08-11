"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Timer,
  TriangleAlert,
  X,
} from "lucide-react";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { requestStatusLabelKey, requestStatusVariant } from "./request-status-utils";
import { DECISION_TERM_TYPES, type RequestDatePreset, type RequestListRow } from "./types";
import { useAdminRequestsList, useBulkDecideRequests } from "./use-requests";

function formatAvgDays(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  return `${(seconds / 86400).toFixed(1)}d`;
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

const DATE_PRESETS: RequestDatePreset[] = [
  "today",
  "tomorrow",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all",
];

const TYPE_FILTERS = [
  "all",
  "leave",
  "sick_leave",
  "loan",
  "asset",
  "fuel",
  "document",
  "complaint",
  "salary_justification",
] as const;

const CLOSED_STATUSES = new Set(["approved", "rejected", "solved"]);

/**
 * Loan, asset and sick-leave approvals must capture terms (amount, tenure, penalty, document)
 * on the final step, which only the detail page can do — so they are never bulk approved.
 */
function canBulkApprove(row: RequestListRow): boolean {
  return (
    !CLOSED_STATUSES.has(row.status) &&
    !(DECISION_TERM_TYPES as readonly string[]).includes(row.request_type)
  );
}

function canBulkReject(row: RequestListRow): boolean {
  return !CLOSED_STATUSES.has(row.status);
}

const STATUS_FILTERS = [
  "all",
  "submitted",
  "pending",
  "in_review",
  "needs_clarification",
  "approved",
  "rejected",
  "solved",
  "overdue",
] as const;

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
}: {
  initialType?: string;
}) {
  const t = useTranslations("pages.requests");
  const router = useRouter();
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");
  const [type, setType] = useState<string>(
    TYPE_FILTERS.includes(initialType as (typeof TYPE_FILTERS)[number])
      ? initialType
      : "all",
  );
  const [status, setStatus] = useState<string>("all");
  const [departmentKey, setDepartmentKey] = useState<string>("all");
  const [zoneId, setZoneId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const bulkDecide = useBulkDecideRequests();

  const filters = useMemo(
    () => ({
      datePreset,
      type: type === "all" ? null : type,
      status: status === "all" ? null : status,
      departmentKey: departmentKey === "all" ? null : departmentKey,
      zoneId: zoneId === "all" ? null : zoneId,
      search: searchApplied,
      limit: 50,
      offset: 0,
    }),
    [datePreset, type, status, departmentKey, zoneId, searchApplied],
  );

  const { data, isLoading, isFetching, refetch } = useAdminRequestsList(filters);
  const { data: zones } = useZonesList();
  const rows = data?.rows ?? [];
  const kpi = data?.kpi;
  const statusCounts = data?.statusCounts ?? {};
  const filteredTotal = data?.filteredTotal ?? rows.length;
  const departmentOptions = data?.departmentOptions ?? [];

  const statusTabs = useMemo(
    () =>
      STATUS_FILTERS.map((key) => {
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
    [statusCounts, t],
  );

  const selectableRows = rows.filter(canBulkReject);
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
    <AppPage>
      <AppPageHeader
        title={t("overviewTitle")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests" />}
            >
              {t("hubLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests/esign" />}
            >
              {t("esignLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests/settings" />}
            >
              {t("settingsLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
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

      <KpiGrid
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

      <AppListCard className="mt-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select
            items={DATE_PRESETS.map((preset) => ({
              value: preset,
              label: t(`datePresets.${preset}`),
            }))}
            value={datePreset}
            onValueChange={(v) => {
              if (v) setDatePreset(v as RequestDatePreset);
            }}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder={t("filters.date")} />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((preset) => (
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

          <Input
            className="h-9 max-w-xs"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearchApplied(search.trim());
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setSearchApplied(search.trim())}
          >
            {t("search")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
          <TabBar
            items={statusTabs}
            activeId={status}
            className="gap-4 border-b-0"
            onSelect={setStatus}
          />
          <p className="text-xs text-muted-foreground tabular-nums">
            {t("resultCount", {
              shown: `${rows.length}`,
              total: `${filteredTotal}`,
            })}
          </p>
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
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              ...(canDecide
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
                {canDecide ? (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={row.request_code}
                      checked={selected.has(row.id)}
                      disabled={!canBulkReject(row)}
                      onCheckedChange={() => toggleRow(row.id)}
                    />
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
                      <p className="truncate text-sm font-medium">{row.driver_name}</p>
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {row.driver_zone ? (
                          <>
                            <MapPin className="h-3 w-3" />
                            {row.driver_zone}
                          </>
                        ) : (
                          row.driver_code
                        )}
                      </p>
                      <Link
                        href={`/requests/${row.id}`}
                        className="text-[10px] text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t("viewDetails")}
                      </Link>
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
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/requests/${row.id}`);
                    }}
                  >
                    <ExternalLink className="me-1 h-3.5 w-3.5" />
                    {t("open")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

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
