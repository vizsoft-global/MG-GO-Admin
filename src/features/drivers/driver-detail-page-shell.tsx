"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { hasOpsAssignment } from "./driver-assignment";
import { isNonOperationalOnly } from "@/features/employees/employee-catalogs";
import { useEmployeeSections } from "@/features/employees/use-employee-catalogs";
import { DriverAccountStatusEditor } from "./driver-account-status-editor";
import { DriverBlockEditor } from "./driver-block-editor";
import { DriverFreezeEditor } from "./driver-freeze-editor";
import { DriverLoginVerificationExemptEditor } from "./driver-login-verification-exempt-editor";
import { DriverScreenshotsAllowedEditor } from "./driver-screenshots-allowed-editor";
import { DriverDocumentsTab } from "./driver-documents-tab";
import { DriverLoginVerificationTab } from "./driver-login-verification-tab";
import { DriverDevicesTab } from "./driver-devices-tab";
import { DriverLocationTab } from "./driver-location-tab";
import { DriverAttendanceTab } from "./driver-attendance-tab";
import { DriverActivityTab } from "./driver-activity-tab";
import { DriverHistoryTab } from "./driver-history-tab";
import { DriverPerformanceTab } from "./driver-performance-tab";
import { DriverWrongActionsTab } from "@/features/wrong-actions/driver-wrong-actions-tab";
import { DriverArchiveDialog } from "./driver-archive-dialog";
import { DriverLevelOverrideDialog } from "./driver-level-badge";
import { DriverEditSheet } from "./driver-edit-sheet";
import { useDriverLevelOverride } from "./use-driver-levels";
import {
  isLinkedDriver,
  showsMobileAppLink,
} from "./driver-workflow-ui";
import { formatPhoneDisplay } from "./driver-phone";
import { AssetCatalogIcon } from "@/features/assets/asset-catalog-icon";
import type { DriverAccountStatus, DriverWorkflowStatus } from "./types";
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
import { PrivateInformationTab } from "./detail/private-information-tab";
import { ProjectTab } from "./detail/project-tab";
import { DRIVERS_TABS, driverDetailHref } from "./drivers-list-query";

type DetailTabId =
  | "private-information"
  | "project"
  | "history"
  | "attendance"
  | "performance"
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
  | "wrong-actions"
  | "driver-devices";

/**
 * Allowlist of pages that may claim the back arrow, keyed by the `from` search param.
 *
 * An allowlist rather than a returned path: `from` arrives from the URL, so treating it as a
 * href would let any link off this page point the arrow anywhere.
 */
const DRIVER_BACK_TARGETS: Record<
  string,
  {
    href: string;
    labelKey: "backToList" | "backToLiveTracking" | "backToRequest" | "backToDriverDevices";
  }
> = {
  "live-tracking-v2": { href: "/live-tracking-v2", labelKey: "backToLiveTracking" },
  "live-tracking": { href: "/live-tracking", labelKey: "backToLiveTracking" },
  "driver-devices": { href: "/driver-devices", labelKey: "backToDriverDevices" },
  pending: { href: "/drivers?tab=pending", labelKey: "backToList" },
  on_duty: { href: "/drivers?tab=on_duty", labelKey: "backToList" },
  multi_device: { href: "/drivers?tab=multi_device", labelKey: "backToList" },
  archived: { href: "/drivers?tab=archived", labelKey: "backToList" },
};

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same shape as a request id — a rider is addressed by the same uuid — and kept separate so the
 * two parameters are validated for what they are rather than sharing a name that reads wrong.
 */
const DRIVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function DetailSkeleton() {
  return (
    <AppPage className="space-y-4 animate-pulse">
      <div className="h-8 w-32 rounded-md bg-muted" />
      <div className="rounded-[14px] border border-border bg-card px-6 py-[22px]">
        <div className="flex gap-[18px]">
          <div className="size-[60px] shrink-0 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-48 rounded-md bg-muted" />
            <div className="h-4 w-32 rounded-md bg-muted" />
            <div className="h-4 w-64 rounded-md bg-muted" />
          </div>
        </div>
        <div className="mt-[18px] grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-[10px] bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-10 rounded-lg bg-muted/70" />
        <div className="h-48 rounded-xl bg-muted/50" />
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
    <div className="rounded-[14px] border border-border bg-card px-6 py-5">
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">{t("title")}</p>
      <div className="mt-3 space-y-3">
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

function headerIdentity(
  employeeId: string | null,
  fullName: string | null | undefined,
): { mark: string; title: string } {
  const stored = (employeeId ?? "").trim();
  const prefix = stored.replace(/^emp/i, "") || stored;
  const name = (fullName ?? "").trim();
  const title = prefix && !name.startsWith(prefix) ? `${prefix} ${name}` : name;
  const letter = (name.replace(/^\d+\s*/, "").match(/[A-Za-z\u0600-\u06FF]/)?.[0] ?? name[0] ?? "").toUpperCase();
  const lead = (prefix[0] ?? "").toUpperCase();
  const mark = `${lead}${letter}`.trim().slice(0, 2) || name.slice(0, 2).toUpperCase();
  return { mark, title };
}

function headerPillClass(tone: "ok" | "warn" | "mute"): string {
  if (tone === "ok") return "bg-[#E3F1E6] text-[#1F5C2E]";
  if (tone === "warn") return "bg-[#FCEFD9] text-[#7A4A00]";
  return "bg-[#F2F2F5] text-[#565868]";
}

function headerStatusTone(
  archived: boolean,
  blocked: boolean,
  linked: boolean,
  account: DriverAccountStatus,
): "ok" | "warn" | "mute" {
  if (archived) return "mute";
  if (blocked) return "warn";
  if (!linked) return "warn";
  switch (account) {
    case "active":
      return "ok";
    case "suspended":
      return "warn";
    case "pending":
      return "mute";
    default: {
      const unreachable: never = account;
      return unreachable;
    }
  }
}

const HEADER_BUTTON =
  "h-auto min-h-10 cursor-pointer rounded-lg border border-[#D7D7DF] bg-card px-3.5 text-sm font-medium shadow-none hover:bg-[#F2F2F5]";

function DriverDetailContent({ id }: { id: string }) {
  const t = useTranslations("pages.driverDetail");
  const tBlock = useTranslations("pages.driverDetail.block");
  const tFreeze = useTranslations("pages.driverDetail.freeze");
  const tList = useTranslations("pages.drivers");
  const router = useRouter();
  const { can, accessKind } = useAuth();
  const isPartner = accessKind === "partner";
  const canManage = can("drivers.manage");
  const { sweep, pending: levelSweepPending } = useDriverLevelOverride();
  const [levelOverrideOpen, setLevelOverrideOpen] = useState(false);
  const canViewOps = can("driver_ops.view");
  const canViewPerformance = can("performance.view");
  const canViewWrongActions = can("wrong_actions.view");
  const canExportOps = can("driver_ops.export");
  const { data: driver, isLoading, isError } = useDriverDetail(id);
  const sectionsQuery = useEmployeeSections();
  const searchParams = useSearchParams();
  const archiveDriver = useArchiveDriverIntake();
  const restoreDriver = useRestoreDriverIntake();
  const approveDriver = useApproveDriverIntake();
  const [activeTab, setActiveTab] = useState<DetailTabId>(
    isPartner ? "project" : "private-information",
  );
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [holdApproveSlot, setHoldApproveSlot] = useState(false);
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
    if (searchParams.get("edit") !== "1") {
      editRouteConsumedRef.current = false;
      return;
    }
    if (!driver || !canManage || !driver.intake_id || driver.archived_at) return;
    // Keep `?from=` so closing the edit modal cannot drop the admin out of the queue they came from.
    router.replace(driverDetailHref(id, searchParams.get("from")));
    if (Date.now() < suppressEditOpenUntilRef.current) return;
    if (editRouteConsumedRef.current) return;
    editRouteConsumedRef.current = true;
    setEditOpen(true);
  }, [driver, canManage, id, router, searchParams]);

  useEffect(() => {
    if (isPartner) {
      setActiveTab(searchParams.get("tab") === "documents" ? "documents" : "project");
      return;
    }
    const tab = searchParams.get("tab");
    if (tab === "private-information") {
      setActiveTab("private-information");
    }
    if (tab === "project") {
      setActiveTab("project");
    }
    if (tab === "history") {
      setActiveTab("history");
    }
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
    if (
      tab === "performance" &&
      driver?.linked_profile_id &&
      canViewPerformance
    ) {
      setActiveTab("performance");
    }
  }, [
    searchParams,
    driver?.linked_profile_id,
    canViewOps,
    canViewPerformance,
    isPartner,
  ]);

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
   *
   * The tracking pages additionally carry the rider that was open (`?driver=`, QA #49), handed
   * back so the map re-selects them instead of returning empty. It is passed through only when
   * it is a uuid and only onto an allowlisted target, so the same "never trust the URL as a
   * path" rule covers it.
   */
  const from = searchParams.get("from");
  const requestId = searchParams.get("requestId");
  const trackingTarget = DRIVER_BACK_TARGETS[from ?? ""];
  const requestedDriverId = searchParams.get("driver") ?? "";
  const backDriverId =
    trackingTarget && DRIVER_ID_RE.test(requestedDriverId) ? requestedDriverId : null;
  const carriesDriverId = backDriverId && trackingTarget?.href.startsWith("/live-tracking");
  const backTarget =
    from === "requests" && requestId && REQUEST_ID_RE.test(requestId)
      ? { href: `/requests/${requestId}`, labelKey: "backToRequest" as const }
      : trackingTarget
        ? {
            href: carriesDriverId ? `${trackingTarget.href}?driver=${backDriverId}` : trackingTarget.href,
            labelKey: trackingTarget.labelKey,
          }
        : {
            href: "/drivers",
            labelKey: "backToList" as const,
          };

  /**
   * A list tab was the entry point, so a completed action returns to that same tab instead of
   * the unfiltered list — otherwise approving one rider drops the admin out of the pending
   * queue and they have to reapply the filter for every remaining rider.
   */
  const returnsToFilteredList =
    from != null && (DRIVERS_TABS as readonly string[]).includes(from);
  const exitHref = returnsToFilteredList ? backTarget.href : "/drivers";

  const handleEditOpenChange = (open: boolean) => {
    if (!open) {
      suppressEditOpenUntilRef.current = Date.now() + 1500;
    }
    setEditOpen(open);
    if (!open && searchParams.get("edit") === "1") {
      router.replace(driverDetailHref(id, searchParams.get("from")));
    }
  };

  const tabs: TabItem[] = isPartner
    ? [
        { id: "project", label: t("tabProject") },
        { id: "documents", label: t("tabDocuments") },
      ]
    : [
    { id: "private-information", label: t("tabPrivateInformation") },
    { id: "project", label: t("tabProject") },
    { id: "history", label: t("tabHistory") },
    { id: "attendance", label: t("tabAttendance") },
    ...(canViewPerformance && driver?.linked_profile_id
      ? [{ id: "performance" as const, label: t("tabPerformance") }]
      : []),
    ...(driver?.linked_profile_id
      ? [{ id: "location" as const, label: t("tabLocation") }]
      : []),
    ...(canViewOps && driver?.linked_profile_id
      ? [{ id: "activity" as const, label: t("tabActivity") }]
      : []),
    { id: "documents", label: t("tabDocuments") },
    { id: "login-verification", label: t("tabLoginVerification") },
    { id: "devices", label: t("tabDevices") },
    { id: "assets", label: t("tabAssets") },
    { id: "earnings", label: t("tabEarnings") },
    { id: "deductions", label: t("tabDeductions") },
    { id: "loan", label: t("tabLoan") },
    { id: "complaint", label: t("tabComplaint") },
    ...(canViewWrongActions
      ? [{ id: "wrong-actions" as const, label: t("tabWrongActions") }]
      : []),
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

  // MG Head Office staff have no zone or store by design, so a missing
  // assignment must not hide Approve/Activate from them.
  const sectionKeys = Array.isArray(driver.section_keys) ? driver.section_keys : [];
  const opsNotRequired = isNonOperationalOnly(sectionKeys, sectionsQuery.data ?? []);

  const canApprove =
    canManage &&
    !isArchived &&
    Boolean(driver.intake_id) &&
    !driver.linked_profile_id &&
    (opsNotRequired || hasOpsAssignment(driver.zone_id, driver.restaurant_ids));

  const showApproveButton = canApprove || holdApproveSlot;

  const identity = headerIdentity(driver.employee_id, driver.full_name);
  const headerStatusLabel = isArchived
    ? t("archivedBadge")
    : driver.is_blocked
      ? tBlock("statusBlocked")
      : workflowLabel(driver.workflow_status);
  const headerTone = headerStatusTone(
    isArchived,
    driver.is_blocked,
    isLinkedDriver(driver),
    driver.account_status,
  );

  const showLinked = showsMobileAppLink(driver);

  const metaFields: { label: string; value: string }[] = [
    { label: tList("employeeId"), value: driver.employee_id ?? "—" },
    { label: t("fieldCivilId"), value: driver.civil_id },
    { label: t("fieldPhone"), value: formatPhoneDisplay(driver.phone) },
    {
      label: t("fieldLinked"),
      value: showLinked && driver.linked ? tList("linkedYes") : tList("linkedNo"),
    },
  ];

  /**
   * App access, login checks and the security controls for this driver. They
   * live in the Login Verification details tab (one home, not the aside) so the
   * Profile reads: what the rider is, then how the rider signs in.
   */
  const securityControls = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {driver.linked_profile_id && !isArchived && canManage ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
            {tBlock("title")}
          </p>
          <div className="mt-3">
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
        <div className="rounded-[14px] border border-border bg-card px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
            {tFreeze("title")}
          </p>
          <div className="mt-3">
            <DriverFreezeEditor
              driverId={driver.linked_profile_id}
              intakeId={driver.intake_id ?? driver.id}
              frozenFrom={driver.frozen_from}
              frozenUntil={driver.frozen_until}
              freezeReason={driver.freeze_reason}
              frozenAt={driver.frozen_at}
              canManage={canManage}
            />
          </div>
        </div>
      ) : null}
      {driver.linked_profile_id && !isArchived && canManage ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
            {t("loginVerificationExemptTitle")}
          </p>
          <div className="mt-3">
            <DriverLoginVerificationExemptEditor
              driverId={driver.linked_profile_id}
              intakeId={driver.intake_id ?? driver.id}
              exempt={driver.login_verification_exempt}
              canManage={canManage}
            />
          </div>
        </div>
      ) : null}
      {driver.linked_profile_id && !isArchived && canManage ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
            {t("screenshotsAllowedTitle")}
          </p>
          <div className="mt-3">
            <DriverScreenshotsAllowedEditor
              driverId={driver.linked_profile_id}
              intakeId={driver.intake_id ?? driver.id}
              allowed={driver.screenshots_allowed}
              canManage={canManage}
            />
          </div>
        </div>
      ) : null}
      {!isArchived && canManage ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#A73C24]">
            {t("accountStatus.title")}
          </p>
          <div className="mt-3">
            {driver.linked_profile_id ? (
              <DriverAccountStatusEditor
                driverId={driver.linked_profile_id}
                intakeId={driver.intake_id ?? driver.id}
                status={driver.account_status}
                canActivate={
                  opsNotRequired ||
                  hasOpsAssignment(driver.zone_id, driver.has_published_restaurant ? 1 : 0)
                }
                canManage={canManage}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("approvePendingHint")}</p>
            )}
            {opsNotRequired ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("opsNotRequired")}</p>
            ) : null}
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
    </div>
  );

  const renderTabPanel = () => {
    if (activeTab === "private-information") {
      return <PrivateInformationTab driver={driver} canManage={canManage} />;
    }

    if (activeTab === "project") {
      return (
        <ProjectTab
          driver={driver}
          canManage={canManage}
          opsNotRequired={opsNotRequired}
        />
      );
    }

    if (activeTab === "history") {
      if (!driver.intake_id) {
        return (
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="py-12">
              <AppEmptyState
                title={t("history.emptyTitle")}
                description={t("history.emptyDescription")}
              />
            </div>
          </div>
        );
      }
      return <DriverHistoryTab intakeId={driver.intake_id} />;
    }

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

    if (
      activeTab === "performance" &&
      driver.linked_profile_id &&
      canViewPerformance
    ) {
      return (
        <DriverPerformanceTab
          driverId={driver.linked_profile_id}
          driverName={driver.full_name}
        />
      );
    }

    // Incidents are filed against `drivers.id`, which is the linked profile. An
    // intake that has never been approved has no driver row to attach one to.
    if (activeTab === "wrong-actions" && canViewWrongActions) {
      if (!driver.linked_profile_id) {
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
      return <DriverWrongActionsTab driverId={driver.linked_profile_id} />;
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
        <DriverLoginVerificationTab
          driverId={driver.linked_profile_id}
          controls={securityControls}
        />
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
                    <p className="text-xs font-medium text-foreground">{asset.name}</p>
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

      <section
        aria-label={identity.title}
        className="flex flex-col gap-[18px] rounded-[14px] border border-border bg-card px-6 py-[22px]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="grid size-[60px] shrink-0 place-items-center rounded-xl border border-[#E4E3E8] bg-[#F2F2F5] text-[19px] font-bold text-[#1E1F2E]">
                {identity.mark}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[21px] font-bold tracking-[-0.01em] text-foreground">
                    {identity.title}
                  </h1>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      headerPillClass(headerTone),
                    )}
                  >
                    {headerStatusLabel}
                  </span>
                </div>
                <p className="text-[13px] text-muted-foreground">{driver.zone_label}</p>
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={HEADER_BUTTON}
                      onClick={() => setLevelOverrideOpen(true)}
                    >
                      {tList("levelOverrideTitle")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={HEADER_BUTTON}
                      disabled={levelSweepPending}
                      onClick={() => {
                        void sweep().then((result) => {
                          if (result.ok) toast.success(tList("levelEvaluateDone"));
                          else toast.error(tList("levelOverrideFailed"));
                        });
                      }}
                    >
                      {tList("levelEvaluate")}
                    </Button>
                  </div>
                ) : null}
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
                          // The queue return is immediate, so the minted passcode has to outlive
                          // the page it was generated on.
                          duration: result.passcode ? 12000 : undefined,
                        });
                        if (returnsToFilteredList) router.push(exitHref);
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
                  variant="outline"
                  className={cn(HEADER_BUTTON, "border-[#E8C4B6] text-[#B5401F] hover:bg-[#F7E9E4] hover:text-[#B5401F]")}
                  disabled={archiveDriver.isPending}
                  onClick={() => setArchiveOpen(true)}
                >
                  {archiveDriver.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t("archiveDriver")}
                </Button>
                <DriverArchiveDialog
                  open={archiveOpen}
                  onOpenChange={setArchiveOpen}
                  pending={archiveDriver.isPending}
                  onConfirm={async (reason) => {
                    try {
                      await archiveDriver.mutateAsync({
                        intakeId: driver.intake_id!,
                        reason,
                      });
                      setArchiveOpen(false);
                      toast.success(t("archived"));
                      router.push(exitHref);
                    } catch (err) {
                      const key =
                        err instanceof Error && isDriverErrorKey(err.message)
                          ? err.message
                          : "save_failed";
                      toast.error(
                        key === "missing_archive_reason"
                          ? t("archiveReasonRequired")
                          : t("archiveFailed"),
                      );
                    }
                  }}
                />
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

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {metaFields.map((field) => (
              <div
                key={field.label}
                className="flex flex-col gap-[3px] rounded-[10px] border border-border px-3.5 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  {field.label}
                </p>
                <p className="truncate text-base font-semibold text-foreground">{field.value}</p>
              </div>
            ))}
          </div>
      </section>

      <div className="min-w-0 space-y-4">
          <TabBar
            items={tabs.map(({ id: tabId, label }) => ({ id: tabId, label }))}
            activeId={activeTab}
            className="gap-0.5"
            markerClassName="border-accent"
            onSelect={(tabId) => setActiveTab(tabId as DetailTabId)}
          />
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            {renderTabPanel()}
          </div>
      </div>
      <DriverLevelOverrideDialog
        driverId={id}
        open={levelOverrideOpen}
        onOpenChange={setLevelOverrideOpen}
      />
    </AppPage>
  );
}

export function DriverDetailPageShell({ id }: { id: string }) {
  return <DriverDetailContent id={id} />;
}
