"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { SearchField } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  copyAccess,
  diffAccess,
  ticksToAppAccess,
  type AppAccessLevel,
  type AppAccessMap,
} from "@/lib/auth/app-access";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import {
  APP_NAV_KEY_BY_ID,
  MENU_REGISTRY,
} from "@/lib/menu/menu-registry";
import {
  LAUNCHER_LABEL_OVERRIDE,
  type AppAccessModuleId,
} from "@/lib/menu/launcher-modules";
import {
  copyRoleTemplateTicks,
  getUserTicksForCopy,
  type RequestTypeGrant,
  type StaffAccessListRow,
} from "@/features/settings/staff-access-actions";
import type { EsignCategoryGrant } from "@/features/esign/esign-staff-access";

type CopyTab = "user" | "role";

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function CopyAccessDialog({
  open,
  onOpenChange,
  current,
  users,
  roles,
  currentUserId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: AppAccessMap;
  users: StaffAccessListRow[];
  roles: AdminRoleRow[];
  currentUserId: string;
  onApply: (
    next: AppAccessMap,
    requestTypes?: RequestTypeGrant[],
    esignCategories?: EsignCategoryGrant[],
  ) => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const tNav = useTranslations();
  const tCommon = useTranslations("common");
  const [tab, setTab] = useState<CopyTab>("user");
  const [userQuery, setUserQuery] = useState("");
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [sourceRoleId, setSourceRoleId] = useState("");
  const [keepSubViews, setKeepSubViews] = useState(false);
  const [preview, setPreview] = useState<AppAccessMap | null>(null);
  const [copiedTypes, setCopiedTypes] = useState<RequestTypeGrant[] | undefined>(undefined);
  const [copiedEsign, setCopiedEsign] = useState<EsignCategoryGrant[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyableRoles = roles.filter((role) => !role.isSuperAdmin);

  const copyableUsers = useMemo(
    () => users.filter((row) => row.id !== currentUserId),
    [users, currentUserId],
  );

  const visibleUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return copyableUsers;
    return copyableUsers.filter((row) =>
      [row.fullName, row.email, row.roleName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [copyableUsers, userQuery]);

  const appLabel = (appId: AppAccessModuleId) => {
    const override = LAUNCHER_LABEL_OVERRIDE[appId];
    const navKey = APP_NAV_KEY_BY_ID[appId];
    const fromNav = navKey ? tNav(`nav.${navKey}`) : null;
    const registry = MENU_REGISTRY.find((item) => item.id === appId);
    return override ?? fromNav ?? registry?.defaultLabel ?? appId;
  };

  const levelLabel = (level: AppAccessLevel) => {
    switch (level) {
      case "none":
        return t("levelNone");
      case "viewer":
        return t("levelViewer");
      case "user":
        return t("levelUser");
      case "manager":
        return t("levelManager");
      default: {
        const _exhaustive: never = level;
        return _exhaustive;
      }
    }
  };

  const diff = preview ? diffAccess(current, preview) : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const run = async () => {
      setError(null);
      if (tab === "user") {
        if (!sourceUserId) {
          setPreview(null);
          setCopiedTypes(undefined);
          setCopiedEsign(undefined);
          return;
        }
        setBusy(true);
        try {
          const loaded = await getUserTicksForCopy(sourceUserId);
          if (cancelled) return;
          if (loaded.error || !loaded.slugs) {
            setError(t("errors.copyFailed"));
            setPreview(null);
            return;
          }
          const source = ticksToAppAccess(loaded.slugs);
          setPreview(copyAccess(source, current, keepSubViews));
          setCopiedTypes(keepSubViews ? undefined : loaded.requestTypes);
          setCopiedEsign(keepSubViews ? undefined : loaded.esignCategories);
        } finally {
          if (!cancelled) setBusy(false);
        }
        return;
      }
      if (!sourceRoleId) {
        setPreview(null);
        setCopiedTypes(undefined);
        setCopiedEsign(undefined);
        return;
      }
      setBusy(true);
      try {
        const loaded = await copyRoleTemplateTicks(sourceRoleId);
        if (cancelled) return;
        if (loaded.error || !loaded.slugs) {
          setError(t("errors.copyFailed"));
          setPreview(null);
          return;
        }
        setPreview(copyAccess(ticksToAppAccess(loaded.slugs), current, keepSubViews));
        setCopiedTypes(undefined);
        setCopiedEsign(undefined);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [open, tab, sourceUserId, sourceRoleId, keepSubViews, current, t]);

  const apply = () => {
    if (!preview) return;
    onApply(preview, copiedTypes, copiedEsign);
    onOpenChange(false);
    setPreview(null);
  };

  const reset = () => {
    setPreview(null);
    setError(null);
    setUserQuery("");
    setSourceUserId(null);
    setSourceRoleId("");
    setTab("user");
    setKeepSubViews(false);
    setCopiedTypes(undefined);
    setCopiedEsign(undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        className="flex w-[min(480px,96vw)] flex-col gap-0 overflow-hidden rounded-2xl p-0"
        showCloseButton
      >
        <DialogHeader className="gap-1 border-b border-[#E4E4E7] px-5 py-4 pe-12">
          <DialogTitle className="text-base font-semibold text-[#18181B]">
            {t("copyAccess")}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#71717A]">
            {t("copySubtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div className="flex h-9 rounded-lg bg-[#F4F4F5] p-[3px]">
            <button
              type="button"
              onClick={() => {
                setTab("user");
                setPreview(null);
              }}
              className={cn(
                "flex-1 cursor-pointer rounded-md text-xs transition-colors duration-150",
                tab === "user"
                  ? "bg-white font-medium text-[#18181B] shadow-sm"
                  : "text-[#71717A]",
              )}
            >
              {t("copyFromUser")}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("role");
                setPreview(null);
              }}
              className={cn(
                "flex-1 cursor-pointer rounded-md text-xs transition-colors duration-150",
                tab === "role"
                  ? "bg-white font-medium text-[#18181B] shadow-sm"
                  : "text-[#71717A]",
              )}
            >
              {t("copyFromRole")}
            </button>
          </div>

          {tab === "user" ? (
            <>
              <SearchField
                value={userQuery}
                onChange={setUserQuery}
                placeholder={t("searchUsers")}
                clearLabel={t("clearSearch")}
                inputClassName="h-9 rounded-lg border-[#E4E4E7] bg-white text-xs ps-8"
              />
              <ul className="max-h-[220px] overflow-auto rounded-lg border border-[#E4E4E7]">
                {visibleUsers.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("emptyUsers")}
                  </li>
                ) : (
                  visibleUsers.map((row) => {
                    const selected = row.id === sourceUserId;
                    const name = row.fullName ?? row.email ?? "—";
                    const hint = [
                      row.staffDepartment ? t(`dept.${row.staffDepartment}`) : null,
                      t("modulesSelected", { count: row.modulesSelected }),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={row.id} className="border-b border-[#F4F4F5] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setSourceUserId(row.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-start transition-colors duration-150",
                            selected ? "bg-[#FAFAFA]" : "hover:bg-[#FAFAFA]",
                          )}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#FDE68A] text-xs font-semibold text-[#574500]">
                            {initials(row.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[#18181B]">
                              {name}
                            </span>
                            <span className="block truncate text-xs text-[#71717A]">{hint}</span>
                          </span>
                          {selected ? (
                            <Check className="size-4 shrink-0 text-[#18181B]" aria-hidden />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          ) : (
            <ul className="max-h-[220px] overflow-auto rounded-lg border border-[#E4E4E7]">
              {copyableRoles.map((role) => {
                const selected = role.id === sourceRoleId;
                return (
                  <li key={role.id} className="border-b border-[#F4F4F5] last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSourceRoleId(role.id)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-start transition-colors duration-150",
                        selected ? "bg-[#FAFAFA]" : "hover:bg-[#FAFAFA]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#18181B]">
                        {role.name}
                      </span>
                      {selected ? (
                        <Check className="size-4 shrink-0 text-[#18181B]" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {diff && preview ? (
            <div className="space-y-1.5 text-xs">
              <p className="font-medium text-[#18181B]">
                {t("diffAdded", { count: diff.addedApps.length })}
                {" · "}
                {t("diffRemoved", { count: diff.removedApps.length })}
              </p>
              <ul className="space-y-1 text-[#71717A]">
                {diff.addedApps.map((appId) => (
                  <li key={`add-${appId}`}>
                    + {appLabel(appId)} ({levelLabel(preview[appId]?.level ?? "user")})
                  </li>
                ))}
                {diff.removedApps.map((appId) => (
                  <li key={`rm-${appId}`}>− {appLabel(appId)}</li>
                ))}
                {diff.levelChanges.map((change) => (
                  <li key={`lv-${change.appId}`}>
                    {appLabel(change.appId)} ({levelLabel(change.from)} → {levelLabel(change.to)})
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("copyPreviewHint")}</p>
          )}

          <label className="flex items-center gap-2 text-xs text-[#18181B]">
            <Checkbox
              checked={keepSubViews}
              onCheckedChange={(checked) => {
                setKeepSubViews(checked === true);
              }}
            />
            {t("keepSubViews")}
          </label>
        </div>

        <DialogFooter className="gap-2 border-t border-[#E4E4E7] px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9 rounded-lg bg-[#18181B] text-white hover:bg-[#27272A]"
            onClick={apply}
            disabled={!preview || busy}
          >
            {t("copyTitle")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
