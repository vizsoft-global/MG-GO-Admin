"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Search } from "lucide-react";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { cn } from "@/lib/utils";
import { CATALOG_SLUGS } from "@/lib/auth/permission-catalog";
import {
  managerDowngradeSeedTicks,
  type PartnerProjectKey,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import {
  APP_ACCESS_CATALOG,
  appAccessToTicks,
  copyAccess,
  diffAccess,
  emptyAppAccess,
  preservedUnknownSlugs,
  setAppLevel,
  setRcmSides,
  ticksToAppAccess,
  toggleAppSubView,
  type AppAccessLevel,
  type AppAccessMap,
  type StaffDepartment,
} from "@/lib/auth/app-access";
import { APP_NAV_KEY_BY_ID, MENU_REGISTRY } from "@/lib/menu/menu-registry";
import {
  LAUNCHER_LABEL_OVERRIDE,
  type AppAccessModuleId,
} from "@/lib/menu/launcher-modules";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import {
  copyRoleTemplateTicks,
  getStaffAccess,
  saveStaffAccess,
  type RequestTypeGrant,
  type RequestTypeOption,
  type StaffAccessListRow,
  type StaffLastChanged,
} from "@/features/settings/staff-access-actions";
import { grantsKeyForEsign, type EsignCategoryGrant } from "@/features/esign/esign-staff-access";
import { isPenaltyChild } from "@/features/esign/esign-penalty-subcategories";
import { useRouter } from "@/i18n/navigation";
import { useApplySidebarEpochs } from "@/contexts/sidebar-epochs-context";
import { queryKeys } from "@/lib/query/query-keys";
import { StaffUserList } from "./staff-user-list";
import { UserAccessHeader } from "./user-access-header";
import { AppAccessCard, appCardMatchesQuery, appHasAccess } from "./app-access-card";
import { CopyAccessDialog } from "./copy-access-dialog";
import { AccessPageHeader, AccessKpiRow, AccessTabs, type AccessKpi } from "./access-page-header";
import { AccessSummary, type SummaryApp, type SummaryStats } from "./access-summary";
import {
  RolesPermissionsPanel,
  type PermissionRow,
} from "@/features/settings/roles-permissions-panel";
import { ACCESS_BTN_PRIMARY, ACCESS_BTN_SECONDARY, ACCESS_CARD } from "./access-ui";

type AppFilter = "all" | "with" | "none";
type WorkspaceMode = "summary" | "edit";

const TOTAL_APPS = APP_ACCESS_CATALOG.length;
const TOTAL_SUB_VIEWS = APP_ACCESS_CATALOG.reduce((sum, entry) => sum + entry.subViews.length, 0);

function fullAccessMap(): AppAccessMap {
  const map = emptyAppAccess();
  for (const entry of APP_ACCESS_CATALOG) {
    map[entry.appId] = {
      appId: entry.appId,
      level: "manager",
      custom: false,
      subViews: entry.subViews.map((view) => view.id),
      ...(entry.rcm ? { sender: true, receiver: true } : {}),
    };
  }
  return map;
}

function grantsKey(rows: RequestTypeGrant[]): string {
  return [...rows]
    .map((row) => `${row.requestType}:${row.accessLevel}`)
    .sort()
    .join("|");
}

function withTypeLevels(rows: RequestTypeGrant[], receiver: boolean): RequestTypeGrant[] {
  const level = receiver ? "approver" : "view_only";
  return rows.map((row) => ({ ...row, accessLevel: level }));
}

function rowKind(row: StaffAccessListRow): StaffAccessKind {
  return row.isSuperAdmin ? "manager" : (row.accessKind ?? "user");
}

function accessErrorKey(
  code: string,
): "errors.invalidRole" | "errors.lastSuperAdmin" | "errors.notAuthorized" | "errors.saveFailed" {
  switch (code) {
    case "invalid_role":
      return "errors.invalidRole";
    case "last_super_admin":
      return "errors.lastSuperAdmin";
    case "super_admin_forbidden":
    case "not_authorized":
      return "errors.notAuthorized";
    default:
      return "errors.saveFailed";
  }
}

/**
 * `/settings/roles` in the shape of Figma `7103:29497`: page header, the three
 * tabs, the four KPI cards, then the staff list beside the access summary.
 */
export function AccessControlShell({
  rows,
  loadError,
  roles,
  requestTypes,
  initialUserId,
  initialTab = "staff",
  permissions = [],
  usageCounts = [],
  nowMs,
}: {
  rows: StaffAccessListRow[];
  loadError?: string;
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
  initialUserId?: string | null;
  initialTab?: "staff" | "roles";
  permissions?: PermissionRow[];
  usageCounts?: { roleId: string; userCount: number }[];
  nowMs: number;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const locale = useLocale();
  const router = useRouter();

  const [userSearch, setUserSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"all" | StaffDepartment>("all");
  const [tab, setTab] = useState<"staff" | "roles">(initialTab);

  const firstId =
    initialUserId && rows.some((row) => row.id === initialUserId)
      ? initialUserId
      : (rows[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(firstId);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const unsavedRef = useRef(0);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const replaceUrl = (userId: string | null) => {
    router.replace(userId ? `/settings/roles?user=${userId}` : "/settings/roles");
  };

  const selectUser = (id: string) => {
    if (id === selectedId) return;
    if (unsavedRef.current > 0) {
      setPendingUserId(id);
      setLeaveOpen(true);
      return;
    }
    setSelectedId(id);
    replaceUrl(id);
  };

  const confirmLeave = () => {
    if (!pendingUserId) return;
    setSelectedId(pendingUserId);
    replaceUrl(pendingUserId);
    setPendingUserId(null);
  };

  const selectTab = (next: "staff" | "roles") => {
    setTab(next);
    router.replace(next === "roles" ? "/settings/roles?tab=roles" : "/settings/roles");
  };

  const kpis = useMemo<AccessKpi[]>(() => {
    const total = rows.length;
    const superAdmins = rows.filter((row) => row.isSuperAdmin).length;
    const fullAccess = rows.filter(
      (row) => row.isSuperAdmin || row.accessKind === "manager",
    ).length;
    const customRows = rows.filter((row) => !row.isSuperAdmin && row.accessKind === "user");
    const custom = customRows.length;
    const invited = rows.filter((row) => !row.isSuperAdmin && row.accessKind == null).length;
    const active = total - invited;
    const averageApps =
      custom === 0
        ? 0
        : Math.round(
            customRows.reduce((sum, row) => sum + row.modulesSelected, 0) / custom,
          );
    const since = nowMs - 30 * 24 * 60 * 60 * 1000;
    const changed = rows
      .filter((row) => row.lastChanged.at != null)
      .filter((row) => new Date(row.lastChanged.at as string).getTime() >= since)
      .sort(
        (a, b) =>
          new Date(b.lastChanged.at as string).getTime() -
          new Date(a.lastChanged.at as string).getTime(),
      );
    const latest = changed[0];

    return [
      {
        label: t("kpiStaff"),
        value: total,
        meta: t("kpiStaffMeta", { active, pending: invited }),
      },
      {
        label: t("kpiFull"),
        value: fullAccess,
        meta: t("kpiFullMeta", { count: superAdmins }),
      },
      {
        label: t("kpiCustom"),
        value: custom,
        meta: t("kpiCustomMeta", { apps: averageApps, total: TOTAL_APPS }),
      },
      {
        label: t("kpiChanges"),
        value: changed.length,
        meta: latest
          ? t("kpiChangesLatest", {
              name: latest.fullName ?? latest.email ?? t("someone"),
              date: new Date(latest.lastChanged.at as string).toLocaleDateString(locale, {
                day: "numeric",
                month: "short",
              }),
            })
          : t("kpiChangesNone"),
      },
    ];
  }, [locale, nowMs, rows, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AccessPageHeader inviteHref="/settings/access-requests" />
      <AccessTabs
        active={tab}
        staffCount={rows.length}
        roleCount={roles.length}
        onSelect={selectTab}
      />
      <AccessKpiRow items={kpis} />

      {loadError ? <p className="text-xs text-destructive">{t("errors.loadFailed")}</p> : null}

      {tab === "roles" ? (
        <section className={cn(ACCESS_CARD, "min-h-0 flex-1 p-4")}>
          <RolesPermissionsPanel
            roles={roles}
            permissions={permissions}
            usageCounts={usageCounts}
          />
        </section>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 items-start gap-4",
          tab === "staff"
            ? "grid lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]"
            : "hidden",
        )}
      >
        <StaffUserList
          rows={rows}
          selectedId={selectedId}
          search={userSearch}
          onSearch={setUserSearch}
          department={departmentFilter}
          onDepartment={setDepartmentFilter}
          onSelect={selectUser}
          totalApps={TOTAL_APPS}
        />
        {selectedRow ? (
          <StaffAccessWorkspace
            key={selectedRow.id}
            row={selectedRow}
            rows={rows}
            roles={roles}
            requestTypes={requestTypes}
            unsavedRef={unsavedRef}
          />
        ) : (
          <div
            className={cn(
              ACCESS_CARD,
              "flex min-h-[200px] items-center justify-center p-6 text-sm text-[#8c8798]",
            )}
          >
            {t("emptyUsers")}
          </div>
        )}
      </div>

      <SimpleConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t("leaveTitle")}
        description={t("leaveDescription")}
        confirmLabel={t("leaveConfirm")}
        confirmVariant="default"
        onConfirm={confirmLeave}
      />
    </div>
  );
}


function StaffAccessWorkspace({
  row,
  rows,
  roles,
  requestTypes,
  unsavedRef,
}: {
  row: StaffAccessListRow;
  rows: StaffAccessListRow[];
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
  unsavedRef: { current: number };
}) {
  const t = useTranslations("pages.settings.accessControl");
  const tNav = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const applyEpochs = useApplySidebarEpochs();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const [mode, setMode] = useState<WorkspaceMode>("summary");
  const [appFilter, setAppFilter] = useState<AppFilter>("all");
  const [appQuery, setAppQuery] = useState("");

  const initialKind = rowKind(row);
  const initialAccess = ticksToAppAccess(row.slugs);
  const initialProject: PartnerProjectKey = row.partnerProjectKey ?? "keeta";
  const [kind, setKind] = useState<StaffAccessKind>(initialKind);
  const [partnerProject, setPartnerProject] = useState<PartnerProjectKey>(initialProject);
  const [access, setAccess] = useState<AppAccessMap>(initialAccess);
  const [unknown, setUnknown] = useState<string[]>(() => preservedUnknownSlugs(row.slugs));
  const [roleId, setRoleId] = useState<string | null>(row.roleId);
  const [grants, setGrants] = useState<RequestTypeGrant[]>([]);
  const [esignGrants, setEsignGrants] = useState<EsignCategoryGrant[]>([]);
  const [lastChanged, setLastChanged] = useState<StaffLastChanged>(row.lastChanged);
  const [baseline, setBaseline] = useState({
    kind: initialKind,
    partnerProject: initialProject,
    access: initialAccess,
    roleId: row.roleId,
    grants: [] as RequestTypeGrant[],
    esignGrants: [] as EsignCategoryGrant[],
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState<StaffAccessKind>("user");

  const draftRole = roles.find((role) => role.id === roleId) ?? null;
  const draftIsSuperAdmin = draftRole?.isSuperAdmin === true;
  const fullAccess = draftIsSuperAdmin || kind === "manager";
  const cardsLocked = fullAccess;
  const displayAccess = fullAccess ? fullAccessMap() : access;

  const appLabel = useCallback(
    (appId: AppAccessModuleId) => {
      const override = LAUNCHER_LABEL_OVERRIDE[appId];
      const navKey = APP_NAV_KEY_BY_ID[appId];
      const fromNav = navKey ? tNav(`nav.${navKey}`) : null;
      const registry = MENU_REGISTRY.find((item) => item.id === appId);
      return override ?? fromNav ?? registry?.defaultLabel ?? appId;
    },
    [tNav],
  );

  const appIcon = useCallback((appId: AppAccessModuleId) => {
    const registry = MENU_REGISTRY.find((item) => item.id === appId);
    return registry?.defaultIcon ?? "LayoutDashboard";
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStaffAccess(row.id).then((loaded) => {
      if (cancelled || !loaded.detail) return;
      setGrants(loaded.detail.requestTypes);
      setEsignGrants(loaded.detail.esignCategories);
      setLastChanged(loaded.detail.lastChanged);
      setBaseline((prev) => ({
        ...prev,
        grants: loaded.detail!.requestTypes,
        esignGrants: loaded.detail!.esignCategories,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const unsaved = useMemo(() => {
    let count = 0;
    if (kind !== baseline.kind) count += 1;
    if (partnerProject !== baseline.partnerProject) count += 1;
    if (roleId !== baseline.roleId) count += 1;
    if (grantsKey(grants) !== grantsKey(baseline.grants)) count += 1;
    if (grantsKeyForEsign(esignGrants) !== grantsKeyForEsign(baseline.esignGrants)) count += 1;
    if (!fullAccess) count += diffAccess(baseline.access, access).changeCount;
    return count;
  }, [access, baseline, esignGrants, fullAccess, grants, kind, partnerProject, roleId]);

  useEffect(() => {
    unsavedRef.current = unsaved;
  }, [unsaved, unsavedRef]);


  const applyKind = (next: StaffAccessKind) => {
    setMode("edit");
    if (draftIsSuperAdmin) return;
    if (kind === "manager" && next !== "manager") {
      setPendingKind(next);
      setDowngradeOpen(true);
      return;
    }
    setKind(next);
  };

  const applyRole = (nextId: string) => {
    setMode("edit");
    setRoleId(nextId);
    const next = roles.find((role) => role.id === nextId);
    if (next?.isSuperAdmin) setKind("manager");
  };

  const confirmDowngrade = () => {
    switch (pendingKind) {
      case "partner":
        setKind("partner");
        break;
      case "user": {
        const seeded = managerDowngradeSeedTicks(CATALOG_SLUGS);
        setKind("user");
        setAccess(ticksToAppAccess(seeded));
        setUnknown(preservedUnknownSlugs(seeded));
        break;
      }
      case "manager":
        break;
      default: {
        const unreachable: never = pendingKind;
        return unreachable;
      }
    }
  };

  const draftTicks = useMemo(
    () => (fullAccess ? [] : appAccessToTicks(access, unknown)),
    [access, fullAccess, unknown],
  );

  const visibleApps = useMemo(() => {
    return APP_ACCESS_CATALOG.filter((entry) => {
      const item = displayAccess[entry.appId];
      const label = appLabel(entry.appId);
      if (!appCardMatchesQuery(label, appQuery)) return false;
      if (appFilter === "with") return appHasAccess(item);
      if (appFilter === "none") return !appHasAccess(item);
      return true;
    });
  }, [appFilter, appLabel, appQuery, displayAccess]);

  const localizedTypes = useMemo(
    () =>
      requestTypes.map((type) => ({
        ...type,
        labelEn: locale === "ar" && type.labelAr ? type.labelAr : type.labelEn,
      })),
    [locale, requestTypes],
  );

  const name = row.fullName ?? row.email ?? t("selectedUser");

  const appCounts = useMemo(() => {
    const withAccess = APP_ACCESS_CATALOG.filter((entry) =>
      appHasAccess(displayAccess[entry.appId]),
    ).length;
    return {
      all: APP_ACCESS_CATALOG.length,
      with: withAccess,
      none: APP_ACCESS_CATALOG.length - withAccess,
    };
  }, [displayAccess]);

  const summaryApps = useMemo(() => {
    const open: SummaryApp[] = [];
    const blocked: SummaryApp[] = [];
    for (const entry of APP_ACCESS_CATALOG) {
      const item = displayAccess[entry.appId];
      const granted = appHasAccess(item);
      const included = entry.subViews.filter((view) => item.subViews.includes(view.id));
      const summary: SummaryApp = {
        id: entry.appId as string,
        label: appLabel(entry.appId),
        iconName: appIcon(entry.appId),
        level: item.level,
        subViews: included.map((view) => ({ id: view.id, label: t(view.labelKey) })),
        subViewsTotal: entry.subViews.length,
        hiddenSubViews: entry.subViews
          .filter((view) => !item.subViews.includes(view.id))
          .map((view) => t(view.labelKey)),
      };
      if (granted) open.push(summary);
      else blocked.push(summary);
    }
    return { open, blocked };
  }, [appIcon, appLabel, displayAccess, t]);

  const summaryStats = useMemo<SummaryStats>(() => {
    const open = summaryApps.open;
    return {
      apps: open.length,
      appsTotal: TOTAL_APPS,
      subViews: open.reduce((sum, app) => sum + app.subViews.length, 0),
      subViewsTotal: TOTAL_SUB_VIEWS,
      asManager: open.filter((app) => app.level === "manager").length,
      hiddenSubViews: open.reduce((sum, app) => sum + app.hiddenSubViews.length, 0),
    };
  }, [summaryApps]);

  const summaryMeta = [
    row.email,
    t("appsOfCount", { shown: summaryStats.apps, total: TOTAL_APPS }),
    lastChanged.at != null
      ? t("lastChanged", {
          name: lastChanged.by ?? t("someone"),
          date: new Date(lastChanged.at).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })
      : t("lastChangedNever"),
  ]
    .filter(Boolean)
    .join(" · ");

  const summaryTag = row.isSuperAdmin
    ? t("tagSuperAdmin")
    : kind === "manager"
      ? t("tagFullAccess")
      : kind === "partner"
        ? t("kindPartner")
        : (draftRole?.name ?? row.roleName);


  const save = () => {
    startTransition(async () => {
      const result = await saveStaffAccess({
        userId: row.id,
        accessKind: kind,
        slugs: draftTicks,
        partnerProjectKey: kind === "partner" ? partnerProject : null,
        roleId,
        requestTypes: grants,
        esignCategories: esignGrants,
      });
      if (result.error) {
        toast.error(t(accessErrorKey(result.error)));
        return;
      }
      toast.success(t("saved"));
      applyEpochs(result.epochs);
      void queryClient.invalidateQueries({ queryKey: queryKeys.menu.all() });
      setBaseline({ kind, partnerProject, access, roleId, grants, esignGrants });
      setMode("summary");
      router.refresh();
    });
  };

  const discard = () => {
    setKind(baseline.kind);
    setPartnerProject(baseline.partnerProject);
    setAccess(baseline.access);
    setRoleId(baseline.roleId);
    setGrants(baseline.grants);
    setEsignGrants(baseline.esignGrants);
    setMode("summary");
  };

  const resetRole = () => {
    if (!roleId) {
      toast.error(t("errors.noRole"));
      return;
    }
    startTransition(async () => {
      const loaded = await copyRoleTemplateTicks(roleId);
      if (loaded.error || !loaded.slugs) {
        toast.error(t("errors.copyFailed"));
        return;
      }
      setAccess(copyAccess(ticksToAppAccess(loaded.slugs), access, false));
      setUnknown(preservedUnknownSlugs(loaded.slugs));
      toast.success(t("resetApplied"));
    });
  };

  const appFilters: { id: AppFilter; label: string; count: number }[] = [
    { id: "all", label: t("filterAll"), count: appCounts.all },
    { id: "with", label: t("filterWith"), count: appCounts.with },
    { id: "none", label: t("filterNone"), count: appCounts.none },
  ];

  if (mode === "summary") {
    return (
      <>
        <AccessSummary
          id={row.id}
          name={name}
          tag={summaryTag}
          meta={summaryMeta}
          stats={summaryStats}
          openApps={summaryApps.open}
          noAccessApps={summaryApps.blocked}
          historyHref="/settings/logs"
          onEditAccess={() => setMode("edit")}
          onOpenApp={() => setMode("edit")}
        />
        <CopyAccessDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          current={access}
          users={rows}
          roles={roles}
          currentUserId={row.id}
          onApply={(next, copiedTypes, copiedEsign) => {
            setAccess(next);
            if (copiedTypes) setGrants(copiedTypes);
            if (copiedEsign) setEsignGrants(copiedEsign);
          }}
        />
      </>
    );
  }


  return (
    <>
      <section className={cn(ACCESS_CARD, "flex min-h-0 flex-col")}>
        <div className="border-b border-[#e4ddd9] p-5">
          <UserAccessHeader
            id={row.id}
            name={name}
            email={row.email}
            roleName={draftRole?.name ?? row.roleName}
            lastChanged={lastChanged}
            locale={locale}
            department={row.staffDepartment}
            roleId={roleId}
            roles={roles}
            onRoleId={applyRole}
            accessKind={kind}
            onAccessKind={applyKind}
            partnerProjectKey={partnerProject}
            onPartnerProject={(key) => {
              setMode("edit");
              setPartnerProject(key);
            }}
            disabled={isPending}
            kindDisabled={draftIsSuperAdmin}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#e4ddd9] px-5 py-3">
          <div className="flex h-8 items-center gap-px rounded-lg bg-[#f1eeec] p-[3px]">
            {appFilters.map((filter) => {
              const active = appFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAppFilter(filter.id)}
                  className={cn(
                    "inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs transition-colors duration-150",
                    active
                      ? "bg-white font-medium text-[#27273f] shadow-sm"
                      : "text-[#5e5e72] hover:text-[#27273f]",
                  )}
                >
                  {filter.label}
                  <span className={active ? "text-[#27273f]" : "text-[#8c8798]"}>
                    {filter.count}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="flex h-9 min-w-[180px] items-center gap-2 rounded-lg border border-[#e4ddd9] px-3">
            <Search className="size-4 shrink-0 text-[#8c8798]" aria-hidden />
            <input
              value={appQuery}
              onChange={(event) => setAppQuery(event.target.value)}
              placeholder={t("searchApps")}
              aria-label={t("searchApps")}
              className="min-w-0 flex-1 bg-transparent text-xs text-[#27273f] outline-none placeholder:text-[#8c8798]"
            />
          </label>
          <button
            type="button"
            onClick={resetRole}
            disabled={isPending}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#e4ddd9] bg-white px-2.5 text-xs font-medium text-[#27273f] transition-colors duration-150 hover:bg-[#faf8f7] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("resetRole")}
          </button>
          <p className="ms-auto text-xs text-[#8c8798]">
            {t("unsavedCount", { count: unsaved })}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid gap-3 md:grid-cols-2">
            {visibleApps.map((entry) => (
              <AppAccessCard
                key={entry.appId}
                entry={entry}
                item={displayAccess[entry.appId]}
                iconName={appIcon(entry.appId)}
                label={appLabel(entry.appId)}
                disabled={cardsLocked || isPending}
                requestTypes={localizedTypes}
                grants={grants}
                esignGrants={esignGrants}
                onLevel={(level: AppAccessLevel) =>
                  setAccess((prev) => setAppLevel(prev, entry.appId, level))
                }
                onToggleSubView={(id) =>
                  setAccess((prev) => toggleAppSubView(prev, entry.appId, id))
                }
                onSides={
                  entry.rcm
                    ? (sides) => {
                        setAccess((prev) => setRcmSides(prev, sides));
                        setGrants((prev) => withTypeLevels(prev, sides.receiver));
                      }
                    : undefined
                }
                onToggleType={
                  entry.rcm
                    ? (key) => {
                        const receiver = displayAccess.employeedesk?.receiver === true;
                        setGrants((prev) => {
                          if (prev.some((grant) => grant.requestType === key)) {
                            return prev.filter((grant) => grant.requestType !== key);
                          }
                          return [
                            ...prev,
                            { requestType: key, accessLevel: receiver ? "approver" : "view_only" },
                          ];
                        });
                      }
                    : undefined
                }
                onToggleEsign={
                  entry.rcm
                    ? (key) => {
                        setEsignGrants((prev) => {
                          if (prev.some((grant) => grant.categoryKey === key)) {
                            return prev.filter((grant) => grant.categoryKey !== key);
                          }
                          return [
                            ...prev,
                            {
                              categoryKey: key,
                              parentKey: isPenaltyChild({ key, parent_key: "penalty" })
                                ? "penalty"
                                : null,
                              accessLevel: "sender",
                            },
                          ];
                        });
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#e4ddd9] px-5 py-3">
          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={isPending}
            className={ACCESS_BTN_SECONDARY}
          >
            {t("copyAccessShort")}
          </button>
          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={isPending}
              className={ACCESS_BTN_SECONDARY}
            >
              {t("discard")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isPending || unsaved === 0}
              className={ACCESS_BTN_PRIMARY}
            >
              {isPending ? t("saving") : t("save")}
            </button>
          </div>
        </div>

      </section>
      <CopyAccessDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        current={access}
        users={rows}
        roles={roles}
        currentUserId={row.id}
        onApply={(next, copiedTypes, copiedEsign) => {
          setAccess(next);
          if (copiedTypes) setGrants(copiedTypes);
          if (copiedEsign) setEsignGrants(copiedEsign);
        }}
      />

      <SimpleConfirmDialog
        open={downgradeOpen}
        onOpenChange={setDowngradeOpen}
        title={t("downgradeTitle")}
        description={t("downgradeDescription")}
        confirmLabel={t("downgradeConfirm")}
        confirmVariant="default"
        onConfirm={confirmDowngrade}
      />

    </>
  );
}
