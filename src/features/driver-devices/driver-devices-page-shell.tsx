"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  BatteryWarning,
  BellRing,
  Bug,
  Check,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  SmartphoneNfc,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { formatPhoneInternational } from "@/features/drivers/driver-list-ui";

import {
  exportDriverDevices,
  notifyDriverDevices,
  setDriverDevicesForceUpdate,
} from "./driver-devices-actions";
import {
  decorateDriverDeviceRows,
  driverDeviceMatchesSearch,
  driverDeviceMatchesTab,
  driverDevicesKpis,
} from "./driver-devices-severity";
import {
  batteryNeedsAttention,
  formatAndroid,
  formatBuild,
  formatDeviceName,
  formatProcessor,
  formatRam,
  parseDriverDevicesTab,
  type DriverDeviceListRow,
  type DriverDeviceSeverity,
  type DriverDevicesTab,
} from "./driver-devices-types";
import { buildDriverDevicesXlsx, downloadDriverDevicesXlsx } from "./driver-devices-xlsx";
import { useDriverDevices } from "./use-driver-devices";

const SEVERITY_BADGE: Record<DriverDeviceSeverity, string> = {
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
  high: "border-orange-200 bg-orange-50 text-orange-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function SelectBox({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2 border-foreground bg-background",
        checked && "border-primary bg-primary text-primary-foreground",
        disabled && "opacity-50",
      )}
    >
      {checked ? <Check className="size-3 stroke-[3]" /> : null}
      <Checkbox
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="absolute inset-0 size-full cursor-pointer border-0 bg-transparent opacity-0 shadow-none"
      />
    </span>
  );
}

export function DriverDevicesPageShell() {
  const t = useTranslations("pages.driverDevices");
  const { can } = useAuth();
  const canForce = can("drivers.manage");
  const canNotify = can("notifications.send");
  const canExport = can("driver_devices.export");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching, refetch } = useDriverDevices();

  const activeTab = parseDriverDevicesTab(searchParams.get("tab"));
  const buildParam = searchParams.get("build");
  const buildFilter = buildParam != null && /^\d+$/.test(buildParam) ? Number(buildParam) : null;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [forceOpen, setForceOpen] = useState<"arm" | "clear" | null>(null);
  const [forceMinCode, setForceMinCode] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [pending, startTransition] = useTransition();

  const snapshot = data?.snapshot;
  const sentry = data?.sentry;

  const rows = useMemo(() => {
    if (!snapshot) return [] as DriverDeviceListRow[];
    const byDriver = new Map(
      Object.entries(sentry?.connected ? sentry.byDriver : {}).map(([id, counts]) => [
        id,
        { events: counts.events, issues: counts.issues },
      ]),
    );
    return decorateDriverDeviceRows(snapshot, byDriver);
  }, [snapshot, sentry]);

  const sentryUrlByDriver = useMemo(
    () =>
      new Map(
        Object.entries(sentry?.connected ? sentry.byDriver : {}).map(([id, counts]) => [
          id,
          counts.url,
        ]),
      ),
    [sentry],
  );

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          driverDeviceMatchesTab(row, activeTab) &&
          driverDeviceMatchesSearch(row, search) &&
          (buildFilter == null || row.app_version_code === buildFilter),
      ),
    [rows, activeTab, search, buildFilter],
  );

  const kpis = useMemo(() => driverDevicesKpis(rows), [rows]);

  // Selection is a set of ids and the filters can move under it, so every
  // consumer reads the intersection with what is on screen rather than the raw
  // set — a bulk action must never reach a row the operator cannot see.
  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.driver_id)),
    [visible, selected],
  );

  const replaceQuery = (next: { tab?: DriverDevicesTab; build?: number | null }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? activeTab;
    const nextBuild = next.build === undefined ? buildFilter : next.build;
    if (nextTab !== "all") params.set("tab", nextTab);
    if (nextBuild != null) params.set("build", String(nextBuild));
    const qs = params.toString();
    router.replace(qs ? `/driver-devices?${qs}` : "/driver-devices");
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected(checked ? new Set(visible.map((row) => row.driver_id)) : new Set());
  };

  const openNotify = () => {
    setNotifyTitle(t("notifyDefaultTitle"));
    setNotifyBody(
      t("notifyDefaultBody", {
        version: snapshot?.minVersionName ?? String(snapshot?.minVersionCode ?? ""),
      }),
    );
    setNotifyOpen(true);
  };

  const openForce = (mode: "arm" | "clear") => {
    setForceMinCode(
      snapshot?.minVersionCode != null
        ? String(snapshot.minVersionCode)
        : snapshot?.latestVersionCode != null
          ? String(snapshot.latestVersionCode)
          : "",
    );
    setForceOpen(mode);
  };

  const submitNotify = () => {
    startTransition(async () => {
      const result = await notifyDriverDevices({
        driverIds: selectedRows.map((row) => row.driver_id),
        title: notifyTitle,
        body: notifyBody,
      });
      if ("error" in result) {
        toast.error(
          result.error === "notifications_send_required"
            ? t("errors.notificationsSendRequired")
            : result.error === "missing_fields"
              ? t("errors.missingFields")
              : result.error === "empty_selection"
                ? t("errors.emptySelection")
                : t("errors.notifyFailed"),
        );
        return;
      }
      setNotifyOpen(false);
      setSelected(new Set());
      toast.success(t("notifySent", { pushed: result.pushed, recipients: result.recipients }));
    });
  };

  const submitForce = (enabled: boolean) => {
    const parsed = Number(forceMinCode.trim());
    startTransition(async () => {
      const result = await setDriverDevicesForceUpdate({
        driverIds: selectedRows.map((row) => row.driver_id),
        minVersionCode: enabled && Number.isFinite(parsed) ? parsed : null,
        enabled,
      });
      if ("error" in result) {
        toast.error(
          result.error === "not_authorized"
            ? t("errors.notAuthorized")
            : result.error === "invalid_min_code"
              ? t("errors.invalidMinCode")
              : result.error === "too_many_drivers"
                ? t("errors.tooManyDrivers")
                : result.error === "empty_selection"
                  ? t("errors.emptySelection")
                  : t("errors.saveFailed"),
          { description: "errorDetail" in result ? result.errorDetail : undefined },
        );
        return;
      }
      setForceOpen(null);
      setSelected(new Set());
      toast.success(
        enabled
          ? t("forceArmed", { count: result.updated, code: Math.trunc(parsed) })
          : t("forceCleared", { count: result.updated }),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverDevices.all() });
    });
  };

  const runExport = async () => {
    setIsExporting(true);
    try {
      const payload = await exportDriverDevices();
      const byDriver = new Map(
        Object.entries(payload.sentry.connected ? payload.sentry.byDriver : {}),
      );
      const exportRows = decorateDriverDeviceRows(payload.snapshot, byDriver);
      const buffer = await buildDriverDevicesXlsx(exportRows, {
        minVersionCode: payload.snapshot.minVersionCode,
        minVersionName: payload.snapshot.minVersionName,
        latestVersionCode: payload.snapshot.latestVersionCode,
        sentryConnected: payload.sentry.connected,
        sentryNote: payload.sentry.connected ? undefined : payload.sentry.reason,
      });
      downloadDriverDevicesXlsx(buffer);
      toast.success(t("exportDone", { count: exportRows.length }));
    } catch {
      toast.error(t("errors.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const kpiItems = [
    {
      label: t("kpiTotal"),
      value: isLoading ? "—" : String(kpis.total),
      icon: Smartphone,
      accent: "primary" as const,
    },
    {
      label: t("kpiCritical"),
      value: isLoading ? "—" : String(kpis.critical),
      icon: AlertOctagon,
      accent: "danger" as const,
    },
    {
      label: t("kpiHigh"),
      value: isLoading ? "—" : String(kpis.high),
      icon: AlertTriangle,
      accent: "warning" as const,
    },
    {
      label: t("kpiOutdated"),
      value: isLoading ? "—" : String(kpis.outdated),
      icon: SmartphoneNfc,
      accent: "warning" as const,
    },
    {
      label: t("kpiNoDevice"),
      value: isLoading ? "—" : String(kpis.noDevice),
      icon: ShieldAlert,
    },
    {
      label: t("kpiErrors"),
      value: isLoading ? "—" : String(kpis.withErrors),
      icon: Bug,
      accent: "danger" as const,
    },
  ];

  const allVisibleSelected =
    visible.length > 0 && visible.every((row) => selected.has(row.driver_id));

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer rounded-lg"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("me-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
              {t("refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer rounded-lg"
              disabled={!canExport || isExporting || isLoading}
              onClick={() => void runExport()}
            >
              {isExporting ? (
                <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="me-2 h-3.5 w-3.5" />
              )}
              {t("export")}
            </Button>
          </div>
        }
        tabs={
          <TabBar
            activeId={activeTab}
            onSelect={(id) => replaceQuery({ tab: parseDriverDevicesTab(id) })}
            items={[
              { id: "all", label: t("tabAll"), icon: Smartphone },
              { id: "critical", label: t("tabCritical"), icon: AlertOctagon },
              { id: "high", label: t("tabHigh"), icon: AlertTriangle },
              { id: "outdated", label: t("tabOutdated"), icon: SmartphoneNfc },
              { id: "latest", label: t("tabLatest"), icon: Check },
              { id: "errors", label: t("tabErrors"), icon: Bug },
              { id: "no-device", label: t("tabNoDevice"), icon: ShieldAlert },
              { id: "forced", label: t("tabForced"), icon: ShieldAlert },
            ]}
          />
        }
      />

      <KpiGrid items={kpiItems} compact />

      <AppListCard
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 rounded-lg bg-background ps-9 pe-9"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {buildFilter != null ? (
              <button
                type="button"
                onClick={() => replaceQuery({ build: null })}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-100 px-2.5 text-xs font-semibold text-emerald-900"
              >
                <Check className="h-3 w-3 stroke-[2.5]" />
                {t("buildFilter", { code: buildFilter })}
                <X className="h-3 w-3" />
              </button>
            ) : null}
            {sentry && !sentry.connected ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-100 px-2.5 text-xs font-medium text-amber-800">
                <Bug className="h-3.5 w-3.5" />
                {t(`sentry.${sentry.reason}`)}
              </span>
            ) : null}
          </div>
        }
      >
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <AppEmptyState title={t("loadFailedTitle")} description={t("loadFailedHint")} />
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <>
            {selectedRows.length > 0 ? (
              <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-xs font-medium text-foreground">
                  {t("bulk.selected", { count: selectedRows.length })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg"
                    disabled={!canNotify || pending}
                    onClick={openNotify}
                  >
                    <BellRing className="me-2 h-3.5 w-3.5" />
                    {t("bulk.notify")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg"
                    disabled={!canForce || pending}
                    onClick={() => openForce("arm")}
                  >
                    <ShieldAlert className="me-2 h-3.5 w-3.5" />
                    {t("bulk.forceUpdate")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!canForce || pending}
                    onClick={() => openForce("clear")}
                  >
                    <X className="me-2 h-3.5 w-3.5" />
                    {t("bulk.clearForce")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg"
                    onClick={() => setSelected(new Set())}
                  >
                    {t("bulk.clear")}
                  </Button>
                </div>
              </div>
            ) : null}

            <AppDataTable
              columns={[
                {
                  id: "select",
                  className: "w-12",
                  label: (
                    <SelectBox
                      label={t("bulk.selectAll")}
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAllVisible}
                    />
                  ),
                },
                { id: "driver", label: t("colDriver") },
                { id: "phone", label: t("colPhone") },
                { id: "severity", label: t("colSeverity") },
                { id: "build", label: t("colBuild") },
                { id: "device", label: t("colDevice") },
                { id: "android", label: t("colAndroid") },
                { id: "ram", label: t("colRam") },
                { id: "processor", label: t("colProcessor") },
                { id: "battery", label: t("colBattery") },
                { id: "lastSeen", label: t("colLastSeen") },
                { id: "sentry", label: t("colSentry") },
                { id: "force", label: t("colForce") },
              ]}
              empty={
                visible.length === 0 ? (
                  <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty>
                ) : null
              }
            >
              {visible.map((row) => (
                <DeviceRow
                  key={row.driver_id}
                  row={row}
                  minVersionCode={snapshot?.minVersionCode ?? null}
                  selected={selected.has(row.driver_id)}
                  sentryConnected={sentry?.connected === true}
                  sentryUrl={sentryUrlByDriver.get(row.driver_id) ?? null}
                  onToggle={() => toggleRow(row.driver_id)}
                />
              ))}
            </AppDataTable>
          </>
        )}
      </AppListCard>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(560px,96vw)] overflow-visible px-5 py-4"
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitNotify();
            }}
          >
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="deviceNotifyTitle">
                  {t("notifyTitleLabel")}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="deviceNotifyTitle"
                  className="h-9"
                  value={notifyTitle}
                  onChange={(e) => setNotifyTitle(e.target.value)}
                  maxLength={120}
                  required
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deviceNotifyBody">
                  {t("notifyBodyLabel")}
                  <span className="text-destructive"> *</span>
                </Label>
                <Textarea
                  id="deviceNotifyBody"
                  value={notifyBody}
                  onChange={(e) => setNotifyBody(e.target.value)}
                  rows={3}
                  maxLength={500}
                  required
                  disabled={pending}
                  className="min-h-[72px] resize-none"
                />
                <p className="text-[10px] text-muted-foreground">{t("notifyBodyHint")}</p>
              </div>
            </div>
            <AppModalFooter
              title={t("bulk.notify")}
              subtitle={t("notifySubtitle", { count: selectedRows.length })}
            >
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={pending}
                onClick={() => setNotifyOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" className="h-9" disabled={pending}>
                {pending ? t("sending") : t("notifyConfirm")}
              </Button>
            </AppModalFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={forceOpen !== null} onOpenChange={(open) => !open && setForceOpen(null)}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(560px,96vw)] overflow-visible px-5 py-4"
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitForce(forceOpen === "arm");
            }}
          >
            <div className="space-y-3 pt-1">
              <p className="text-sm text-muted-foreground">
                {forceOpen === "arm"
                  ? t("forceArmHint", { count: selectedRows.length })
                  : t("forceClearHint", { count: selectedRows.length })}
              </p>
              {forceOpen === "arm" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="forceMinCode">
                    {t("forceMinCodeLabel")}
                    <span className="text-destructive"> *</span>
                  </Label>
                  <Input
                    id="forceMinCode"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    className="h-9 w-40 tabular-nums"
                    value={forceMinCode}
                    onChange={(e) => setForceMinCode(e.target.value)}
                    required
                    disabled={pending}
                  />
                  <p className="text-[10px] text-muted-foreground">{t("forceMinCodeHint")}</p>
                </div>
              ) : null}
            </div>
            <AppModalFooter
              title={forceOpen === "arm" ? t("bulk.forceUpdate") : t("bulk.clearForce")}
              subtitle={t("forceSubtitle", { count: selectedRows.length })}
            >
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={pending}
                onClick={() => setForceOpen(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                className={cn("h-9", forceOpen === "clear" && "bg-destructive hover:bg-destructive/90")}
                disabled={pending}
              >
                {pending
                  ? t("saving")
                  : forceOpen === "arm"
                    ? t("forceConfirm")
                    : t("forceClearConfirm")}
              </Button>
            </AppModalFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}

function DeviceRow({
  row,
  minVersionCode,
  selected,
  sentryConnected,
  sentryUrl,
  onToggle,
}: {
  row: DriverDeviceListRow;
  minVersionCode: number | null;
  selected: boolean;
  sentryConnected: boolean;
  sentryUrl: string | null;
  onToggle: () => void;
}) {
  const t = useTranslations("pages.driverDevices");
  const buildBelowMin =
    row.app_version_code == null ||
    (minVersionCode != null && row.app_version_code < minVersionCode);
  const batteryFlag = batteryNeedsAttention(row.device_meta);
  const battery = row.device_meta?.battery_pct;

  return (
    <AppDataTableRow>
      <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
        <SelectBox
          label={t("bulk.selectRow", { code: row.driver_code })}
          checked={selected}
          onCheckedChange={onToggle}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
              avatarTintFromName(row.full_name),
            )}
            aria-hidden
          >
            {initials(row.full_name)}
          </span>
          <div className="min-w-0">
            <Link
              href={`/drivers/${row.driver_id}?from=driver-devices`}
              className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
            >
              {row.full_name}
            </Link>
            <span className="text-[11px] text-muted-foreground">#{row.driver_code}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatPhoneInternational(row.phone)}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
            SEVERITY_BADGE[row.severity],
          )}
        >
          {t(`severity.${row.severity}`)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
            buildBelowMin
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {formatBuild(row)}
        </span>
        {row.buildGap != null && row.buildGap > 0 ? (
          <span className="ms-1.5 text-[10px] text-muted-foreground">
            {t("buildsBehind", { count: row.buildGap })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDeviceName(row)}</TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatAndroid(row)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatRam(row.device_meta)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {row.device_meta?.soc_model ? (
            <Cpu className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          ) : null}
          {formatProcessor(row.device_meta)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {battery == null && !batteryFlag ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium tabular-nums",
              batteryFlag
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
            title={
              row.device_meta?.battery_health || row.device_meta?.battery_temp_c != null
                ? [
                    row.device_meta?.battery_health,
                    row.device_meta?.battery_temp_c != null
                      ? `${row.device_meta.battery_temp_c}°C`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
          >
            {batteryFlag ? <BatteryWarning className="h-3 w-3" aria-hidden /> : null}
            {battery == null ? t("batteryUnknown") : `${battery}%`}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {row.lastSeenDays == null
          ? t("neverSeen")
          : row.lastSeenDays === 0
            ? t("seenToday")
            : t("seenDaysAgo", { count: row.lastSeenDays })}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {!sentryConnected ? (
          // An em dash, never 0: a driver with no crashes and a driver whose
          // crash count could not be read are different facts.
          <span className="text-muted-foreground">—</span>
        ) : row.sentryEvents === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : sentryUrl ? (
          <a
            href={sentryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold tabular-nums text-primary hover:bg-primary/10"
            title={t("sentryIssues", { count: row.sentryIssues })}
          >
            {row.sentryEvents}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span className="font-semibold tabular-nums">{row.sentryEvents}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {row.forced ? (
          <span
            className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive tabular-nums"
            title={row.force_app_update_at ?? undefined}
          >
            {row.force_app_update_min_code != null
              ? t("forcedMin", { code: row.force_app_update_min_code })
              : t("forcedOn")}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </AppDataTableRow>
  );
}
