"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SearchField } from "@/components/app";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATALOG_SLUGS } from "@/lib/auth/permission-catalog";
import { managerDowngradeSeedTicks, type StaffAccessKind } from "@/lib/auth/staff-access";
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
import {
  APP_NAV_KEY_BY_ID,
  MENU_REGISTRY,
} from "@/lib/menu/menu-registry";
import { LAUNCHER_TILE_IDS, LAUNCHER_LABEL_OVERRIDE, type AppAccessModuleId } from "@/lib/menu/launcher-modules";
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
import { useRouter } from "@/i18n/navigation";
import { StaffUserList } from "./staff-user-list";
import { UserAccessHeader } from "./user-access-header";
import { AppAccessCard, appCardMatchesQuery, appHasAccess } from "./app-access-card";
import { AccessPreviewPane } from "./access-preview-pane";
import { CopyAccessDialog } from "./copy-access-dialog";

type AppFilter = "all" | "with" | "none";

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

function withTypeLevels(
  rows: RequestTypeGrant[],
  receiver: boolean,
): RequestTypeGrant[] {
  const level = receiver ? "approver" : "view_only";
  return rows.map((row) => ({ ...row, accessLevel: level }));
}

function rowKind(row: StaffAccessListRow): StaffAccessKind {
  return row.isSuperAdmin ? "manager" : (row.accessKind ?? "user");
}

export function AccessControlShell({
  rows,
  loadError,
  roles,
  requestTypes,
  initialUserId,
}: {
  rows: StaffAccessListRow[];
  loadError?: string;
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
  initialUserId?: string | null;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const router = useRouter();

  const [userSearch, setUserSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"all" | StaffDepartment>("all");

  const firstId = initialUserId && rows.some((row) => row.id === initialUserId)
    ? initialUserId
    : rows[0]?.id ?? null;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loadError ? (
        <p className="mb-2 text-xs text-destructive">{t("errors.loadFailed")}</p>
      ) : null}
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <StaffUserList
          rows={rows}
          selectedId={selectedId}
          search={userSearch}
          onSearch={setUserSearch}
          department={departmentFilter}
          onDepartment={setDepartmentFilter}
          onSelect={selectUser}
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
          <>
            <div className="flex flex-1 items-center justify-center bg-[#FAFAFA] text-sm text-muted-foreground">
              {t("emptyUsers")}
            </div>
            <AccessPreviewPane
              name={t("selectedUser")}
              apps={[]}
              totalApps={LAUNCHER_TILE_IDS.length}
              unsavedCount={0}
              disabled
              onDiscard={() => undefined}
              onSave={() => undefined}
              onCopy={() => undefined}
            />
          </>
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
  const [isPending, startTransition] = useTransition();

  const [appFilter, setAppFilter] = useState<AppFilter>("all");
  const [appQuery, setAppQuery] = useState("");

  const initialKind = rowKind(row);
  const initialAccess = ticksToAppAccess(row.slugs);
  const [kind, setKind] = useState<StaffAccessKind>(initialKind);
  const [access, setAccess] = useState<AppAccessMap>(initialAccess);
  const [unknown, setUnknown] = useState<string[]>(() => preservedUnknownSlugs(row.slugs));
  const [department, setDepartment] = useState<StaffDepartment | null>(row.staffDepartment);
  const [grants, setGrants] = useState<RequestTypeGrant[]>([]);
  const [lastChanged, setLastChanged] = useState<StaffLastChanged>(row.lastChanged);
  const [baseline, setBaseline] = useState({
    kind: initialKind,
    access: initialAccess,
    department: row.staffDepartment,
    grants: [] as RequestTypeGrant[],
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);

  const isSuperAdmin = row.isSuperAdmin;
  const fullAccess = isSuperAdmin || kind === "manager";
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

  useEffect(() => {
    let cancelled = false;
    void getStaffAccess(row.id).then((loaded) => {
      if (cancelled || !loaded.detail) return;
      setGrants(loaded.detail.requestTypes);
      setLastChanged(loaded.detail.lastChanged);
      setBaseline((prev) => ({ ...prev, grants: loaded.detail!.requestTypes }));
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const unsaved = useMemo(() => {
    let count = 0;
    if (kind !== baseline.kind) count += 1;
    if (department !== baseline.department) count += 1;
    if (grantsKey(grants) !== grantsKey(baseline.grants)) count += 1;
    if (!fullAccess) count += diffAccess(baseline.access, access).changeCount;
    return count;
  }, [access, baseline, department, fullAccess, grants, kind]);

  useEffect(() => {
    unsavedRef.current = unsaved;
  }, [unsaved, unsavedRef]);

  const applyKind = (next: StaffAccessKind) => {
    if (isSuperAdmin) return;
    if (kind === "manager" && next === "user") {
      setDowngradeOpen(true);
      return;
    }
    setKind(next);
  };

  const confirmDowngrade = () => {
    const seeded = managerDowngradeSeedTicks(CATALOG_SLUGS);
    setKind("user");
    setAccess(ticksToAppAccess(seeded));
    setUnknown(preservedUnknownSlugs(seeded));
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

  const save = () => {
    startTransition(async () => {
      const result = await saveStaffAccess({
        userId: row.id,
        accessKind: kind,
        slugs: draftTicks,
        department,
        requestTypes: grants,
      });
      if (result.error) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setBaseline({ kind, access, department, grants });
      router.refresh();
    });
  };

  const discard = () => {
    setKind(baseline.kind);
    setAccess(baseline.access);
    setDepartment(baseline.department);
    setGrants(baseline.grants);
  };

  const resetRole = () => {
    if (!row.roleId) {
      toast.error(t("errors.noRole"));
      return;
    }
    startTransition(async () => {
      const loaded = await copyRoleTemplateTicks(row.roleId!);
      if (loaded.error || !loaded.slugs) {
        toast.error(t("errors.copyFailed"));
        return;
      }
      setAccess(copyAccess(ticksToAppAccess(loaded.slugs), access, false));
      setUnknown(preservedUnknownSlugs(loaded.slugs));
      toast.success(t("resetApplied"));
    });
  };

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

  const previewApps = useMemo(
    () =>
      APP_ACCESS_CATALOG.filter((entry) => appHasAccess(displayAccess[entry.appId])).map(
        (entry) => {
          const registry = MENU_REGISTRY.find((item) => item.id === entry.appId);
          const item = displayAccess[entry.appId];
          return {
            id: entry.appId as string,
            label: appLabel(entry.appId),
            iconName: registry?.defaultIcon ?? "LayoutDashboard",
            subViewLabels: entry.subViews
              .filter((view) => item.subViews.includes(view.id))
              .map((view) => t(view.labelKey)),
          };
        },
      ),
    [appLabel, displayAccess, t],
  );

  const appFilters: { id: AppFilter; label: string; count: number }[] = [
    { id: "all", label: t("filterAll"), count: appCounts.all },
    { id: "with", label: t("filterWith"), count: appCounts.with },
    { id: "none", label: t("filterNone"), count: appCounts.none },
  ];

  return (
    <>
      <section className="flex min-h-0 flex-col bg-[#FAFAFA]">
        <UserAccessHeader
          name={name}
          email={row.email}
          roleName={row.roleName}
          lastChanged={lastChanged}
          locale={locale}
          department={department}
          onDepartment={setDepartment}
          accessKind={kind}
          onAccessKind={applyKind}
          disabled={isPending || isSuperAdmin}
        />
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="flex h-9 items-center gap-px rounded-lg bg-[#EAEAEC] p-[3px]">
            {appFilters.map((filter) => {
              const active = appFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAppFilter(filter.id)}
                  className={cn(
                    "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors duration-150",
                    active
                      ? "bg-white font-medium text-[#18181B] shadow-sm"
                      : "text-[#52525B] hover:text-[#18181B]",
                  )}
                >
                  {filter.label}
                  <span className={active ? "text-[#18181B]" : "text-[#9CA3AF]"}>
                    {filter.count}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 cursor-pointer rounded-lg border-[#E4E4E7] bg-white px-2.5 text-[12.5px] font-medium text-[#18181B]"
            onClick={resetRole}
            disabled={isPending || isSuperAdmin}
          >
            <RotateCcw className="me-1.5 size-3.5" />
            {t("resetRole")}
          </Button>
          <SearchField
            value={appQuery}
            onChange={setAppQuery}
            placeholder={t("searchApps")}
            clearLabel={t("clearSearch")}
            className="min-w-[180px]"
            inputClassName="h-9 rounded-lg border-[#E4E4E7] bg-white text-[12.5px]"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <div className="grid gap-4 md:grid-cols-2">
              {visibleApps.map((entry) => {
                const registry = MENU_REGISTRY.find((item) => item.id === entry.appId);
                return (
                  <AppAccessCard
                    key={entry.appId}
                    entry={entry}
                    item={displayAccess[entry.appId]}
                    iconName={registry?.defaultIcon ?? "LayoutDashboard"}
                    label={appLabel(entry.appId)}
                    disabled={cardsLocked || isPending}
                    requestTypes={localizedTypes}
                    grants={grants}
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
                                {
                                  requestType: key,
                                  accessLevel: receiver ? "approver" : "view_only",
                                },
                              ];
                            });
                          }
                        : undefined
                    }
                  />
                );
              })}
          </div>
        </div>
      </section>

      <AccessPreviewPane
        name={name}
        apps={previewApps}
        totalApps={LAUNCHER_TILE_IDS.length}
        unsavedCount={unsaved}
        saving={isPending}
        disabled={isSuperAdmin}
        onDiscard={discard}
        onSave={save}
        onCopy={() => setCopyOpen(true)}
      />

      <CopyAccessDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        current={access}
        users={rows}
        roles={roles}
        currentUserId={row.id}
        onApply={(next, copiedTypes) => {
          setAccess(next);
          if (copiedTypes) setGrants(copiedTypes);
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
