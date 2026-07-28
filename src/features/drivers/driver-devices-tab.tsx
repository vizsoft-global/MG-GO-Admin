"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, LogOut, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
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

        {sortedHistory.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className={cn("overflow-x-auto", activeDevice ? "mt-4" : "")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDevice")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colOs")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colAppVersion")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colFirstSeen")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colLastSeen")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedHistory.map((session) => (
                  <TableRow
                    key={session.session_id}
                    className={cn(
                      session.is_active &&
                        "border-s-primary/30 bg-primary/5 hover:bg-primary/10",
                    )}
                  >
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-medium">{formatDeviceLabel(session)}</p>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="cursor-default font-mono text-[10px] text-muted-foreground">
                                {truncateDeviceId(session.device_id)}
                              </span>
                            }
                          />
                          <TooltipContent>{session.device_id}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{formatOsVersion(session)}</TableCell>
                    <TableCell className="text-sm">{formatAppVersion(session)}</TableCell>
                    <TableCell className="text-sm">
                      {formatSeenAt(session.first_seen_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatSeenAt(session.last_seen_at)}
                      {session.flush_deadline_at &&
                      resolveDeviceSessionStatus(session) === "override_pending" ? (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">
                          {t("flushUntil", { time: formatSeenAt(session.flush_deadline_at) })}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <DeviceStatusPill session={session} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isFetching && !isLoading ? (
          <p className="mt-2 text-[10px] text-muted-foreground">{t("refreshing")}</p>
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
