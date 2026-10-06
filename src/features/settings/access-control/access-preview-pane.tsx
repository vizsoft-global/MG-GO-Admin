"use client";

import { createElement, useMemo } from "react";
import { useTranslations } from "next-intl";
import { APP_NAV_KEY_BY_ID, resolveIcon } from "@/lib/menu/menu-registry";
import { LAUNCHER_TILE_IDS, visibleLauncherTiles } from "@/lib/menu/launcher-modules";
import { buildInitialTree } from "@/lib/menu/menu-merge";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { LAYOUT } from "@/components/app/layout-spacing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AccessPreviewPane({
  name,
  ticks,
  fullAccess,
  unsavedCount,
  saving,
  onDiscard,
  onSave,
}: {
  name: string;
  ticks: readonly string[];
  fullAccess: boolean;
  unsavedCount: number;
  saving?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const tNav = useTranslations();
  const tickSet = useMemo(() => new Set(ticks), [ticks]);

  const sidebar = useMemo(() => {
    const can = (permission: Permission) =>
      hasPermissionInSet(tickSet, permission, fullAccess);
    return buildInitialTree(can, fullAccess);
  }, [tickSet, fullAccess]);

  const launcherCount = useMemo(
    () => visibleLauncherTiles(tickSet, fullAccess).length,
    [tickSet, fullAccess],
  );

  return (
    <aside className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm")}>
      <div className={LAYOUT.panelSection}>
        <p className="text-sm font-semibold">{t("previewTitle", { name })}</p>
        <p className="text-[10px] text-muted-foreground">
          {t("launcherShows", { shown: launcherCount, total: LAUNCHER_TILE_IDS.length })}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <ul className="space-y-2">
          {sidebar.map((group) => (
              <li key={group.id}>
                <p className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {createElement(resolveIcon(group.icon), { className: "size-3" })}
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {(group.children ?? (group.href ? [group] : [])).map((item) => {
                    const navKey = APP_NAV_KEY_BY_ID[item.id];
                    const label = navKey ? tNav(`nav.${navKey}`) : item.label;
                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]"
                      >
                        {createElement(resolveIcon(item.icon), {
                          className: "size-3 text-muted-foreground",
                        })}
                        <span className="truncate">{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {t("unsavedCount", { count: unsavedCount })}
        </p>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" className="h-9" onClick={onDiscard} disabled={saving || unsavedCount === 0}>
            {t("discard")}
          </Button>
          <Button type="button" className="h-9" onClick={onSave} disabled={saving || unsavedCount === 0}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
