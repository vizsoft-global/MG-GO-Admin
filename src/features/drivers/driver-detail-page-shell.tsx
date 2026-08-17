"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Banknote,
  Bike,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  Camera,
  FileText,
  ListChecks,
  Loader2,
  MapPin,
  Minus,
  Package,
  Pencil,
  Phone,
  RefreshCw,
  Shield,
  Smartphone,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DriverAccountStatusEditor } from "./driver-account-status-editor";
import { DriverBlockEditor } from "./driver-block-editor";
import { DriverLoginVerificationExemptEditor } from "./driver-login-verification-exempt-editor";
import { DriverDocumentsTab } from "./driver-documents-tab";
import { DriverLoginVerificationTab } from "./driver-login-verification-tab";
import { DriverDevicesTab } from "./driver-devices-tab";
import { DriverLocationTab } from "./driver-location-tab";
import { DriverAttendanceTab } from "./driver-attendance-tab";
import { DriverActivityTab } from "./driver-activity-tab";
import { DriverEditSheet } from "./driver-edit-sheet";
import { getCountryLabel } from "@/lib/geo/countries";
import { riderCategoryMessageKey } from "./driver-rider-category";
import { avatarTintFromName } from "./form/driver-form-primitives";
import { LinkedBadge, WorkflowStatusPill, isLinkedDriver, resolveWorkflowPillStatus } from "./driver-workflow-ui";
import { formatPhoneDisplay } from "./driver-phone";
import { AssetCatalogIcon } from "@/features/assets/asset-catalog-icon";
import type { DriverWorkflowStatus } from "./types";
import {
  AccountStatusPill,
  AttendancePill,
  formatDriverCodeDisplay,
} from "./driver-list-ui";
import {
  useApproveDriverIntake,
  useArchiveDriverIntake,
  useRestoreDriverIntake,
  useDriverDetail,
  useRegenerateDriverPasscode,
} from "./use-drivers";
import { isDriverErrorKey } from "./driver-errors";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { queryKeys } from "@/lib/query/query-keys";
import { DriverDetailGroups } from "./driver-detail-groups";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";
import { formatCustomFieldDisplay } from "@/lib/custom-fields/validate";

type DetailTabId =
  | "attendance"
  | "activity"
  | "location"
  | "documents"
  | "login-verification"
  | "devices"
  | "assets"
  | "earnings"
  | "deductions"
  | "loan"
  | "complaint"
  | "wrong-actions";

/**
 * Allowlist of pages that may claim the back arrow, keyed by the `from` search param.
 *
 * An allowlist rather than a returned path: `from` arrives from the URL, so treating it as a
 * href would let any link off this page point the arrow anywhere.
 */
const DRIVER_BACK_TARGETS: Record<
  string,
  { href: string; labelKey: "backToList" | "backToLiveTracking" }
> = {
  "live-tracking-v2": { href: "/live-tracking-v2", labelKey: "backToLiveTracking" },
  "live-tracking": { href: "/live-tracking", labelKey: "backToLiveTracking" },
};

function DetailSkeleton() {
  return (
    <AppPage className="space-y-4 animate-pulse">
      <div className="h-8 w-32 rounded-md bg-muted" />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex gap-4">
          <div className="h-16 w-16 shrink-0 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-48 rounded-md bg-muted" />
            <div className="h-4 w-32 rounded-md bg-muted" />
            <div className="h-4 w-64 rounded-md bg-muted" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <div className="h-10 rounded-lg bg-muted/70" />
          <div className="h-48 rounded-xl bg-muted/50" />
        </div>
        <div className="space-y-3">
          <div className="h-36 rounded-xl bg-muted/50" />
          <div className="h-48 rounded-xl bg-muted/50" />
        </div>
      </div>
    </AppPage>
  );
}

function PasscodeCard({
  driverId,
  intakeId,
  passcode,
  isActive,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  passcode: string | null;
  isActive: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail.passcode");
  const [revealed, setRevealed] = useState(false);
  const regenerate = useRegenerateDriverPasscode();

  const masked = passcode ? "••••••" : "—";
  const display = revealed && passcode ? passcode : masked;

  const handleCopy = async () => {
    if (!passcode) return;
    try {
      await navigator.clipboard.writeText(passcode);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const handleRegenerate = async () => {
    if (!canManage) return;
    if (!window.confirm(t("regenerateConfirm"))) return;
    try {
      await regenerate.mutateAsync({ driverId, intakeId });
      setRevealed(true);
      toast.success(t("regenerated"));
    } catch {
      toast.error(t("regenerateFailed"));
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      </div>
      <div className="space-y-3 px-4 py-4">
        {!isActive ? (
          <p className="text-sm text-muted-foreground">{t("inactiveHint")}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "tabular-nums font-mono text-2xl font-semibold tracking-[0.35em] text-foreground",
                  !passcode && "text-muted-foreground",
                )}
                aria-label={revealed && passcode ? t("ariaRevealed") : t("ariaHidden")}
              >
                {display}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer"
                  disabled={!passcode}
                  onClick={() => setRevealed((v) => !v)}
                  aria-label={revealed ? t("hide") : t("reveal")}
                >
                  {revealed ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer"
                  disabled={!passcode}
                  onClick={handleCopy}
                  aria-label={t("copy")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("description")}</p>
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full cursor-pointer rounded-lg"
                onClick={handleRegenerate}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t("regenerate")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function DriverDetailContent({ id }: { id: string }) {
  const t = useTranslations("pages.driverDetail");
  const tBlock = useTranslations("pages.driverDetail.block");
  const tNew = useTranslations("pages.driverNew");
  const tList = useTranslations("pages.drivers");
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("drivers.manage");
  const canViewOps = can("driver_ops.view");
  const canExportOps = can("driver_ops.export");
  const { data: driver, isLoading, isError } = useDriverDetail(id);
  const { data: customFieldDefs = [] } = useCustomFieldDefinitions({
    includeInactive: true,
  });
  const customFieldLabelByKey = useMemo(() => {
    const m = new Map<string, { label: string; field_type: (typeof customFieldDefs)[number]["field_type"]; options: (typeof customFieldDefs)[number]["options"] }>();
    for (const d of customFieldDefs) {
      m.set(d.key, { label: d.label, field_type: d.field_type, options: d.options });
    }
    return m;
  }, [customFieldDefs]);
  const searchParams = useSearchParams();
  const archiveDriver = useArchiveDriverIntake();
  const restoreDriver = useRestoreDriverIntake();
  const approveDriver = useApproveDriverIntake();
  const [activeTab, setActiveTab] = useState<DetailTabId>("assets");
  const [editOpen, setEditOpen] = useState(false);
  const [holdApproveSlot, setHoldApproveSlot] = useState(false);
  const editIntentFromUrlRef = useRef<boolean | null>(null);
  const editRouteConsumedRef = useRef(false);
  const suppressEditOpenUntilRef = useRef(0);

  const openEditSheet = () => {
    if (Date.now() < suppressEditOpenUntilRef.current) return;
    setEditOpen(true);
  };

  useRealtimeInvalidator({
    channel: `admin-driver-detail-${id}`,
    tables: [
      { table: "drivers" },
      { table: "driver_intakes" },
      { table: "driver_restaurants" },
      { table: "driver_intake_restaurants" },
    ],
    invalidateKeys: [queryKeys.drivers.all(), queryKeys.drivers.detail(id)],
    enabled: Boolean(id),
  });

  const isArchived = Boolean(driver?.archived_at);

  useEffect(() => {
    editIntentFromUrlRef.current = searchParams.get("edit") === "1";
    editRouteConsumedRef.current = false;
    setEditOpen(false);
    setHoldApproveSlot(false);
    // Only reset sheet state when navigating to a different driver — not when ?edit=1 is stripped.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams intentionally read once per id
  }, [id]);

  useEffect(() => {
    if (editIntentFromUrlRef.current !== true) return;
    if (editRouteConsumedRef.current) return;
    if (!driver || !canManage || !driver.intake_id || driver.archived_at) return;
    editRouteConsumedRef.current = true;
    editIntentFromUrlRef.current = false;
    setEditOpen(true);
    router.replace(`/drivers/${id}`);
  }, [driver, canManage, id, router]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "location" && driver?.linked_profile_id) {
      setActiveTab("location");
    }
    if (tab === "devices") {
      setActiveTab("devices");
    }
    if (tab === "login-verification") {
      setActiveTab("login-verification");
    }
    if (tab === "documents") {
      setActiveTab("documents");
    }
    if (tab === "activity" && driver?.linked_profile_id && canViewOps) {
      setActiveTab("activity");
    }
  }, [searchParams, driver?.linked_profile_id, canViewOps]);

  /*
   * Where "back" goes, when the caller says so.
   *
   * The arrow was a fixed link to `/drivers`, so opening a driver from Live Tracking and
   * pressing back dropped the operator on the driver list — losing the map, the filters and
   * the selection they had built up. A `from` parameter is preferred over `router.back()`
   * because this page is routinely deep-linked (`?tab=`, `?edit=1`) and reloaded, and after a
   * reload there is no history entry to go back to. An unrecognised value falls through to the
   * list rather than being trusted as a path, so the parameter cannot be used to point the
   * button at an arbitrary URL.
   */
  const backTarget = DRIVER_BACK_TARGETS[searchParams.get("from") ?? ""] ?? {
    href: "/drivers",
    labelKey: "backToList" as const,
  };

  const handleEditOpenChange = (open: boolean) => {
    setEditOpen(open);
    if (!open && searchParams.get("edit") === "1") {
      router.replace(`/drivers/${id}`);
    }
  };

  const tabs: TabItem[] = [
    { id: "attendance", label: t("tabAttendance"), icon: CalendarClock },
    ...(driver?.linked_profile_id
      ? [{ id: "location" as const, label: t("tabLocation"), icon: MapPin }]
      : []),
    ...(canViewOps && driver?.linked_profile_id
      ? [{ id: "activity" as const, label: t("tabActivity"), icon: ListChecks }]
      : []),
    { id: "documents", label: t("tabDocuments"), icon: FileText },
    { id: "login-verification", label: t("tabLoginVerification"), icon: Camera },
    { id: "devices", label: t("tabDevices"), icon: Smartphone },
    { id: "assets", label: t("tabAssets"), icon: Package },
    { id: "earnings", label: t("tabEarnings"), icon: Wallet },
    { id: "deductions", label: t("tabDeductions"), icon: Banknote },
    { id: "loan", label: t("tabLoan"), icon: Banknote },
    { id: "complaint", label: t("tabComplaint"), icon: AlertTriangle },
    { id: "wrong-actions", label: t("tabWrongActions"), icon: Shield },
  ];

  if (isLoading) return <DetailSkeleton />;
  if (isError || !driver) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t("notFoundTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("notFoundDescription")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4 cursor-pointer rounded-lg"
          nativeButton={false}
          render={<Link href="/drivers" />}
        >
          {t("backToList")}
        </Button>
      </div>
    );
  }

  const accountStatusLabel = (status: typeof driver.account_status) => {
    switch (status) {
      case "active":
        return tList("statusActive");
      case "suspended":
        return tList("statusSuspended");
      case "pending":
        return tList("statusPendingAccount");
      default:
        return status;
    }
  };

  const workflowLabel = (status: DriverWorkflowStatus) => {
    if (isLinkedDriver(driver)) {
      return accountStatusLabel(driver.account_status);
    }
    if (status === "draft") {
      return tList("statusDraft");
    }
    return tList("statusPending");
  };

  const canApprove =
    canManage &&
    !isArchived &&
    Boolean(driver.intake_id) &&
    !driver.linked_profile_id &&
    driver.restaurant_ids.length > 0;

  const showApproveButton = canApprove || holdApproveSlot;

  const initials = driver.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const metaFields: { label: string; value: string }[] = [
    { label: t("fieldPhone"), value: formatPhoneDisplay(driver.phone) },
    {
      label: t("fieldLinked"),
      value: driver.linked ? tList("linkedYes") : tList("linkedNo"),
    },
    { label: t("fieldEmail"), value: driver.email ?? "—" },
    { label: t("fieldCivilId"), value: driver.civil_id },
    {
      label: tList("employeeId"),
      value: driver.employee_id ?? "—",
    },
    {
      label: t("fieldNationality"),
      value: getCountryLabel(driver.nationality) ?? "—",
    },
    {
      label: t("fieldRiderCategory"),
      value: tList(`riderCategory.${riderCategoryMessageKey(driver.rider_category)}`),
    },
    { label: t("fieldZone"), value: driver.zone_label },
    {
      label: t("fieldBaseEarnings"),
      value:
        driver.base_earnings_kwd != null
          ? `${driver.base_earnings_kwd} KD`
          : "—",
    },
    { label: t("fieldPartner"), value: driver.partner_name },
    {
      label: t("fieldRestaurants"),
      value:
        driver.restaurant_names.length > 0
          ? driver.restaurant_names.join(", ")
          : "—",
    },
    { label: t("fieldBike"), value: driver.vehicle_label ?? "—" },
    { label: t("fieldJoined"), value: driver.joined_at ?? "—" },
    ...Object.entries(driver.custom_fields ?? {}).map(([key, value]) => {
      const def = customFieldLabelByKey.get(key);
      return {
        label: def?.label ?? key,
        value: def
          ? formatCustomFieldDisplay(def.field_type, value, def.options) || "—"
          : value == null || value === ""
            ? "—"
            : String(value),
      };
    }),
  ];

  const renderTabPanel = () => {
    if (activeTab === "location" && driver.linked_profile_id) {
      return (
        <DriverLocationTab
          profileDriverId={driver.linked_profile_id}
          driverName={driver.full_name}
        />
      );
    }

    if (activeTab === "attendance" && driver.linked_profile_id) {
      return <DriverAttendanceTab driverId={driver.linked_profile_id} />;
    }

    if (activeTab === "activity" && driver.linked_profile_id && canViewOps) {
      return (
        <DriverActivityTab
          driverId={driver.linked_profile_id}
          driverCode={driver.driver_code}
          canExport={canExportOps}
        />
      );
    }

    if (activeTab === "attendance") {
      return (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="py-12">
            <AppEmptyState
              title={t("attendanceNeedsLinkTitle")}
              description={t("attendanceNeedsLinkDescription")}
            />
          </div>
        </div>
      );
    }

    if (activeTab === "documents") {
      return (
        <DriverDocumentsTab
          intakeId={driver.intake_id}
          profileId={driver.linked_profile_id}
          canManage={canManage}
          onEdit={openEditSheet}
        />
      );
    }

    if (activeTab === "login-verification" && driver.linked_profile_id) {
      return (
        <DriverLoginVerificationTab driverId={driver.linked_profile_id} />
      );
    }

    if (activeTab === "login-verification") {
      return (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="py-12">
            <AppEmptyState
              title={t("loginVerificationNeedsLinkTitle")}
              description={t("loginVerificationNeedsLinkDescription")}
            />
          </div>
        </div>
      );
    }

    if (activeTab === "devices" && driver.linked_profile_id) {
      return (
        <DriverDevicesTab
          driverId={driver.linked_profile_id}
          canManage={canManage}
        />
      );
    }

    if (activeTab === "devices") {
      return (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="py-12">
            <AppEmptyState
              title={t("devicesNeedsLinkTitle")}
              description={t("devicesNeedsLinkDescription")}
            />
          </div>
        </div>
      );
    }

    if (activeTab === "assets") {
      const assigned = driver.assigned_assets ?? [];
      return (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{t("assetsTitle")}</p>
            <Link
              href="/assets"
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("viewInventory")}
            </Link>
          </div>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAssetsAssigned")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {assigned.map((asset) => (
                  <div
                    key={asset.catalog_item_id}
                    className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-4 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-emerald-200 bg-emerald-100 p-1 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/50 dark:text-emerald-300">
                      <AssetCatalogIcon
                        iconKey={asset.icon_key}
                        imageUrl={asset.image_url}
                        imgClassName="h-full w-full object-contain"
                        iconClassName="h-4 w-4"
                      />
                    </span>
                    <p className="text-[11px] font-medium text-foreground">{asset.name}</p>
                    <Check className="h-4 w-4 text-emerald-600" aria-label={t("issued")} />
                  </div>
                ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col items-center gap-2 py-12">
          <StatusPill variant="warning" dot={false}>
            {t("comingSoon")}
          </StatusPill>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {t("emptyTabDescription")}
          </p>
        </div>
      </div>
    );
  };

  return (
    <AppPage className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-pointer shrink-0"
          nativeButton={false}
          render={<Link href={backTarget.href} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">{t(backTarget.labelKey)}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="flex gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
                {driver.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={driver.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-lg font-semibold text-muted-foreground">
                    {initials}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-foreground">
                    {driver.full_name}
                  </h1>
                  <WorkflowStatusPill
                    status={resolveWorkflowPillStatus(driver)}
                    label={
                      driver.is_blocked
                        ? tBlock("statusBlocked")
                        : workflowLabel(driver.workflow_status)
                    }
                  />
                  <LinkedBadge
                    linked={driver.linked}
                    yesLabel={tList("linkedYes")}
                    noLabel={tList("linkedNo")}
                  />
                  {isArchived ? (
                    <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t("archivedBadge")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-sm text-muted-foreground">
                  {formatDriverCodeDisplay(driver.driver_code)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {driver.zone_label}
                  </span>
                  <span>·</span>
                  <span>{driver.partner_name}</span>
                </p>
                <DriverDetailGroups driverId={driver.linked_profile_id} />
                {driver.is_blocked ? null : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <AccountStatusPill
                      status={driver.account_status}
                      label={accountStatusLabel(driver.account_status)}
                    />
                  </div>
                )}
              </div>
            </div>
            {canManage && driver.intake_id && !isArchived ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {showApproveButton ? (
                  <Button
                    type="button"
                    size="sm"
                    className={cn(
                      "cursor-pointer rounded-lg",
                      !canApprove && "pointer-events-none invisible",
                    )}
                    disabled={!canApprove || approveDriver.isPending}
                    onClick={async () => {
                      if (!window.confirm(t("approveConfirmBody"))) return;
                      try {
                        const result = await approveDriver.mutateAsync(driver.intake_id!);
                        setEditOpen(false);
                        suppressEditOpenUntilRef.current = Date.now() + 800;
                        setHoldApproveSlot(true);
                        window.setTimeout(() => setHoldApproveSlot(false), 800);
                        toast.success(t("approveSuccess"), {
                          description: result.passcode
                            ? t("approvePasscodeHint", { passcode: result.passcode })
                            : undefined,
                        });
                      } catch (err) {
                        const key =
                          err instanceof Error && isDriverErrorKey(err.message)
                            ? err.message
                            : "save_failed";
                        toast.error(
                          isDriverErrorKey(key)
                            ? t(`approveErrors.${key}` as "approveErrors.save_failed")
                            : t("approveErrors.save_failed"),
                        );
                      }
                    }}
                  >
                    {approveDriver.isPending ? (
                      <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="me-2 h-3.5 w-3.5" />
                    )}
                    {t("approveAction")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="cursor-pointer rounded-lg"
                  onClick={openEditSheet}
                >
                  <Pencil className="me-2 h-3.5 w-3.5" />
                  {t("editDriver")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer rounded-lg text-destructive hover:text-destructive"
                  disabled={archiveDriver.isPending}
                  onClick={async () => {
                    if (!window.confirm(t("archiveConfirm"))) return;
                    try {
                      await archiveDriver.mutateAsync(driver.intake_id!);
                      toast.success(t("archived"));
                      router.push("/drivers");
                    } catch {
                      toast.error(t("archiveFailed"));
                    }
                  }}
                >
                  {archiveDriver.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Archive className="me-2 h-4 w-4" />
                  )}
                  {t("archiveDriver")}
                </Button>
                <DriverEditSheet
                  driver={driver}
                  intakeId={driver.intake_id}
                  detailRouteId={id}
                  open={editOpen}
                  onOpenChange={handleEditOpenChange}
                />
              </div>
            ) : null}
            {canManage && driver.intake_id && isArchived ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer rounded-lg"
                  disabled={restoreDriver.isPending}
                  onClick={async () => {
                    if (!window.confirm(t("restoreConfirm"))) return;
                    try {
                      await restoreDriver.mutateAsync({
                        intakeId: driver.intake_id!,
                        detailId: id,
                        profileId: driver.linked_profile_id,
                      });
                      toast.success(t("restored"));
                    } catch (err) {
                      const key =
                        err instanceof Error && isDriverErrorKey(err.message)
                          ? err.message
                          : "save_failed";
                      toast.error(
                        isDriverErrorKey(key)
                          ? t(`restoreErrors.${key}` as "restoreErrors.save_failed")
                          : t("restoreFailed"),
                      );
                    }
                  }}
                >
                  {restoreDriver.isPending ? (
                    <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArchiveRestore className="me-2 h-3.5 w-3.5" />
                  )}
                  {t("restoreDriver")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6 sm:p-5">
            {metaFields.map((field) => (
              <div
                key={field.label}
                className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{field.value}</p>
              </div>
            ))}
          </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <TabBar
            items={tabs}
            activeId={activeTab}
            className="gap-3 overflow-x-auto border-b border-border pb-0 sm:gap-4"
            onSelect={(id) => setActiveTab(id as DetailTabId)}
          />
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            {renderTabPanel()}
          </div>
        </div>

        <aside className="space-y-3">
          {driver.linked_profile_id && !isArchived && canManage ? (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{tBlock("title")}</p>
              </div>
              <div className="px-4 py-4">
                <DriverBlockEditor
                  driverId={driver.linked_profile_id}
                  intakeId={driver.intake_id ?? driver.id}
                  isBlocked={driver.is_blocked}
                  blockedReason={driver.blocked_reason}
                  blockedAt={driver.blocked_at}
                  canManage={canManage}
                />
              </div>
            </div>
          ) : null}
          {driver.linked_profile_id && !isArchived && canManage ? (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-foreground">
                  {t("loginVerificationExemptTitle")}
                </p>
              </div>
              <div className="px-4 py-4">
                <DriverLoginVerificationExemptEditor
                  driverId={driver.linked_profile_id}
                  intakeId={driver.intake_id ?? driver.id}
                  exempt={driver.login_verification_exempt}
                  canManage={canManage}
                />
              </div>
            </div>
          ) : null}
          {!isArchived && canManage ? (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{t("accountStatus.title")}</p>
              </div>
              <div className="px-4 py-4">
                {driver.linked_profile_id ? (
                  <DriverAccountStatusEditor
                    driverId={driver.linked_profile_id}
                    intakeId={driver.intake_id ?? driver.id}
                    status={driver.account_status}
                    hasPublishedRestaurant={driver.has_published_restaurant}
                    canManage={canManage}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("approvePendingHint")}</p>
                )}
              </div>
            </div>
          ) : null}
          {!isArchived ? (
            <PasscodeCard
              driverId={driver.linked_profile_id ?? ""}
              intakeId={driver.intake_id ?? driver.id}
              passcode={driver.app_passcode}
              isActive={driver.account_status === "active"}
              canManage={canManage && Boolean(driver.linked_profile_id)}
            />
          ) : null}
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{t("quickStats")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {(
                [
                  { label: t("statAttendance"), value: "—", tone: "success", icon: CalendarClock },
                  { label: t("statDeliveriesToday"), value: "—", tone: "primary", icon: Package },
                  { label: t("statDeliveriesWeek"), value: "—", tone: "primary", icon: Bike },
                  { label: t("statEarnings"), value: "—", tone: "warning", icon: Wallet },
                ] satisfies Array<{
                  label: string;
                  value: string;
                  tone: Tone;
                  icon: typeof CalendarClock;
                }>
              ).map((stat) => (
                <MetricTile
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  tone={stat.tone}
                  icon={stat.icon}
                  className="min-h-[88px]"
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </AppPage>
  );
}

export function DriverDetailPageShell({ id }: { id: string }) {
  return <DriverDetailContent id={id} />;
}
