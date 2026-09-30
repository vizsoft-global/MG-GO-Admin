"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { PurgeAllDialog } from "./clear-all-module-button";
import { usePurgeAllPreview } from "./use-data-cleanup";
import { purgeBlockerLabel } from "./purge-blockers";
import {
  purgeAllModulesForEntities,
  type PurgeAllEntity,
} from "./purge-entities";

/**
 * Clear all — one row per module, with the live count above the button.
 *
 * The order is the recommended go-live order, not alphabetical: a parent cannot
 * be emptied while a child still points at it, so the list the operator works
 * down is the order the database will actually accept.
 */
export function DataCleanupClearAllPanel({
  entities,
}: {
  entities: readonly PurgeAllEntity[];
}) {
  const t = useTranslations("pages.settings.dataCleanup");
  const { can } = useAuth();
  const [active, setActive] = useState<PurgeAllEntity | null>(null);
  const preview = usePurgeAllPreview(entities);

  const modules = useMemo(() => purgeAllModulesForEntities(entities), [entities]);

  const counts = useMemo(() => {
    const map = new Map<PurgeAllEntity, { count: number; blockers: string[] }>();
    for (const item of preview.data ?? []) {
      map.set(item.entity, { count: item.count, blockers: item.blockers });
    }
    return map;
  }, [preview.data]);

  const runnable = modules.filter((module) => can(module.slug));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              {t("clearAll.bannerTitle")}
            </p>
            <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
              {t("clearAll.bannerBody")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{t("clearAll.scopeNote")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 cursor-pointer rounded-lg"
          onClick={() => void preview.refetch()}
          disabled={preview.isFetching}
        >
          {preview.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <RefreshCw className="me-1.5 h-4 w-4" />
              {t("refresh")}
            </>
          )}
        </Button>
      </div>

      {preview.isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-border">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : preview.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
          {t("errors.previewFailed")}
        </div>
      ) : runnable.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("clearAll.noModules")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {runnable.map((module) => {
            const state = counts.get(module.entity);
            const count = state?.count ?? 0;
            const blockers = state?.blockers ?? [];
            const blocked = blockers.length > 0;
            return (
              <li
                key={module.entity}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {t("clearAll.step", { step: module.goLive })}
                    </Badge>
                    <span className="font-medium">{t(`modules.${module.entity}`)}</span>
                    <Badge variant={count > 0 ? "secondary" : "outline"}>
                      {t("clearAll.countBadge", { count })}
                    </Badge>
                    {blocked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {blockers.map((blocker) => purgeBlockerLabel(t, blocker)).join(" ")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(`clearAll.hints.${module.entity}`)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 cursor-pointer rounded-lg px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={count === 0 || blocked || preview.isFetching}
                  onClick={() => setActive(module.entity)}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="ms-1.5">{t("clearAll.button")}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {active ? (
        <PurgeAllDialog
          open
          onOpenChange={(open) => {
            if (!open) setActive(null);
          }}
          entity={active}
          count={counts.get(active)?.count ?? null}
          blockers={counts.get(active)?.blockers ?? []}
          onFinished={() => void preview.refetch()}
        />
      ) : null}
    </div>
  );
}
