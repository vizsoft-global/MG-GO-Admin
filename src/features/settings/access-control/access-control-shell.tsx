"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SearchField } from "@/components/app";
import { LAYOUT } from "@/components/app/layout-spacing";
import { SegmentOption } from "@/components/app/toggle-chip";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
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
import { LAUNCHER_LABEL_OVERRIDE, type AppAccessModuleId } from "@/lib/menu/launcher-modules";
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
      <div className={`grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)_300px] ${LAYOUT.panelGap}`}>
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
            <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
              {t("emptyUsers")}
            </div>
            <AccessPreviewPane
              name={t("selectedUser")}
              ticks={[]}
              fullAccess={false}
              unsavedCount={0}
              onDiscard={() => undefined}
              onSave={() => undefined}
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

  return (
    <>
      <section className="flex min-h-0 flex-col">
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
          onCopy={() => setCopyOpen(true)}
          onReset={resetRole}
        />
        <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <SegmentOption selected={appFilter === "all"} onClick={() => setAppFilter("all")}>
              {t("filterAll")}
            </SegmentOption>
            <SegmentOption selected={appFilter === "with"} onClick={() => setAppFilter("with")}>
              {t("filterWith")}
            </SegmentOption>
            <SegmentOption selected={appFilter === "none"} onClick={() => setAppFilter("none")}>
              {t("filterNone")}
            </SegmentOption>
            <SearchField
              value={appQuery}
              onChange={setAppQuery}
              placeholder={t("searchApps")}
              clearLabel={t("clearSearch")}
              className="min-w-[160px]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            <div className="grid gap-2 md:grid-cols-2">
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
        </div>
      </section>

      <AccessPreviewPane
        name={name}
        ticks={draftTicks}
        fullAccess={fullAccess}
        unsavedCount={unsaved}
        saving={isPending}
        onDiscard={discard}
        onSave={save}
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
