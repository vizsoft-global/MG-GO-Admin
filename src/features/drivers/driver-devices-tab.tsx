"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, LogOut, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  GroupTableHeaderRow,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusPill } from "@/components/dashboard/status-pill";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { TrackingGlassCard } from "@/features/live-tracking/tracking-shell";
import { cn } from "@/lib/utils";
import {
  formatAppVersion,
  formatDeviceLabel,
  formatOsVersion,
  resolveDeviceSessionStatus,
  type DeviceSessionStatus,
  type DriverDeviceSessionRow,
} from "./device-session-types";
import { useDriverDeviceOverview, useForceSignOutDriver } from "./use-drivers";

function formatSeenAt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatGraceRemaining(deadline: string | null): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  return `${mins}m`;
}

function truncateDeviceId(deviceId: string): string {
  if (deviceId.length <= 12) return deviceId;
  return `${deviceId.slice(0, 6)}…${deviceId.slice(-4)}`;
}

function DeviceStatusPill({ session }: { session: DriverDeviceSessionRow }) {
  const t = useTranslations("pages.driverDetail.devices");
  const status = resolveDeviceSessionStatus(session);
  const labelKey = {
    active: "statusActive",
    override_pending: "statusOverridePending",
    signed_out: "statusSignedOut",
    admin_forced: "statusAdminForced",
    inactive: "statusInactive",
  }[status] as "statusActive";

  return (
    <StatusPill variant={resolveStatusVariant(status)} dot={false}>
      {t(labelKey)}
    </StatusPill>
  );
}

function ActiveDeviceCard({ session }: { session: DriverDeviceSessionRow }) {
  const t = useTranslations("pages.driverDetail.devices");

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <p className="text-sm font-semibold text-foreground">{t("activeTitle")}</p>
        </div>
        <DeviceStatusPill session={session} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("colDevice")}</dt>
          <dd className="font-medium">{formatDeviceLabel(session)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("colOs")}</dt>
          <dd>{formatOsVersion(session)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("colAppVersion")}</dt>
          <dd>{formatAppVersion(session)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("colLastSeen")}</dt>
          <dd>{formatSeenAt(session.last_seen_at)}</dd>
        </div>
        {session.flush_deadline_at && resolveDeviceSessionStatus(session) === "override_pending" ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("flushDeadline")}</dt>
            <dd>
              {formatSeenAt(session.flush_deadline_at)}
              {formatGraceRemaining(session.flush_deadline_at)
                ? ` (${t("graceRemaining", { time: formatGraceRemaining(session.flush_deadline_at)! })})`
                : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function DriverDevicesTab({
  driverId,
  canManage,
}: {
  driverId: string;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail.devices");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: overview, isLoading, isFetching, isError, refetch } =
    useDriverDeviceOverview(driverId);
  const forceSignOut = useForceSignOutDriver();

  const hasActiveSession = Boolean(overview?.active_device_id);
  const history = overview?.history ?? [];
  const activeDevice = overview?.active_device;

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)),
    [history],
  );
  const deviceColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "device", label: t("colDevice"), locked: true },
      { id: "os", label: t("colOs") },
      { id: "app", label: t("colAppVersion") },
      { id: "firstSeen", label: t("colFirstSeen") },
      { id: "lastSeen", label: t("colLastSeen") },
      { id: "status", label: t("colStatus"), categorical: true },
    ],
    [t],
  );
  const prefs = useTablePrefs(`driver-devices-${driverId}`, deviceColumns);
  const filteredHistory = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return sortedHistory;
    return sortedHistory.filter((session) =>
      [
        formatDeviceLabel(session),
        formatOsVersion(session),
        formatAppVersion(session),
        session.device_id,
        resolveDeviceSessionStatus(session),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [prefs.appliedQuery, sortedHistory]);
  const groupedHistory = useMemo(
    () =>
      groupRows(
        filteredHistory,
        prefs.groupBy,
        { status: (session) => resolveDeviceSessionStatus(session) },
        {},
        "—",
      ),
    [filteredHistory, prefs.groupBy],
  );
  const listView = useGroupedListView(
    groupedHistory,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const handleForceSignOut = async () => {
    try {
      await forceSignOut.mutateAsync(driverId);
      toast.success(t("forceSignOutSuccess"));
    } catch {
      toast.error(t("forceSignOutFailed"));
    }
  };

  if (isError) {
    return (
      <TrackingGlassCard className="border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-slate-900">
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-9"
          onClick={() => void refetch()}
        >
          {t("retry")}
        </Button>
      </TrackingGlassCard>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TrackingGlassCard className="border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{t("title")}</p>
            <p className="text-xs text-muted-foreground">{t("summary")}</p>
          </div>
          {canManage && hasActiveSession ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setConfirmOpen(true)}
              disabled={forceSignOut.isPending}
            >
              {forceSignOut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              {t("forceSignOut")}
            </Button>
          ) : null}
        </div>

        {activeDevice ? <ActiveDeviceCard session={activeDevice} /> : null}

        <div className={cn(activeDevice ? "mt-4" : "")}>
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={prefs}
                entity={t("title")}
                columns={deviceColumns}
                rowKind="dynamic"
                filteredCount={filteredHistory.length}
                totalCount={sortedHistory.length}
              />
            }
            columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
            empty={
              filteredHistory.length === 0 ? (
                <AppDataTableEmpty>{t("empty")}</AppDataTableEmpty>
              ) : undefined
            }
          >
            {listView.sections.flatMap((section) => [
              section.showHeader ? (
                <GroupTableHeaderRow
                  key={`g-${section.key}`}
                  colSpan={shownColumns.length}
                  label={section.label}
                  total={section.total}
                  open={section.open}
                  page={section.page}
                  showPager={section.showPager}
                  onToggle={() => listView.toggle(section.key)}
                  onStep={(dir) => listView.step(section.key, dir)}
                />
              ) : null,
              ...section.visibleRows.map((session) => (
                <AppDataTableRow
                  key={session.session_id}
                  className={cn(
                    session.is_active && "border-s-primary/30 bg-primary/5 hover:bg-primary/10",
                  )}
                >
                  {shownColumns.map((column) => {
                    switch (column.id) {
                      case "device":
                        return (
                          <TableCell key={column.id}>
                            <div className="space-y-0.5">
                              <TableNameCell name={formatDeviceLabel(session)} />
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span className="cursor-default font-mono text-xs text-muted-foreground">
                                      {truncateDeviceId(session.device_id)}
                                    </span>
                                  }
                                />
                                <TooltipContent>{session.device_id}</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        );
                      case "os":
                        return (
                          <TableCell key={column.id} className="text-sm">
                            {formatOsVersion(session)}
                          </TableCell>
                        );
                      case "app":
                        return (
                          <TableCell key={column.id} className="text-sm">
                            {formatAppVersion(session)}
                          </TableCell>
                        );
                      case "firstSeen":
                        return (
                          <TableCell key={column.id} className="text-sm">
                            {formatSeenAt(session.first_seen_at)}
                          </TableCell>
                        );
                      case "lastSeen":
                        return (
                          <TableCell key={column.id} className="text-sm">
                            {formatSeenAt(session.last_seen_at)}
                            {session.flush_deadline_at &&
                            resolveDeviceSessionStatus(session) === "override_pending" ? (
                              <p className="text-xs text-amber-700 dark:text-amber-400">
                                {t("flushUntil", { time: formatSeenAt(session.flush_deadline_at) })}
                              </p>
                            ) : null}
                          </TableCell>
                        );
                      case "status":
                        return (
                          <TableCell key={column.id}>
                            <DeviceStatusPill session={session} />
                          </TableCell>
                        );
                      default:
                        return null;
                    }
                  })}
                </AppDataTableRow>
              )),
            ])}
          </AppDataTable>
        </div>

        {isFetching && !isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("refreshing")}</p>
        ) : null}
      </TrackingGlassCard>

      <SimpleConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("forceSignOutDialogTitle")}
        description={t("forceSignOutDialogDescription")}
        confirmLabel={t("forceSignOutConfirm")}
        onConfirm={handleForceSignOut}
        isPending={forceSignOut.isPending}
      />
    </div>
  );
}
