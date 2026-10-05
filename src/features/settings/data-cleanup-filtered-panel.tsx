"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurgeFilteredDialog } from "./filtered-purge-dialog";
import { PURGE_FILTER_ENTITIES, purgeFilterColumnLabel } from "./purge-filter-catalog";

/**
 * The Clear-by-filter tab of `/settings/data-cleanup`.
 *
 * A module picker and one button. Everything else — the columns, the values,
 * the count, the review list and the delete — lives in the dialog, because the
 * whole point of this entry point is that the operator is *not* looking at the
 * module while they choose; they are looking at the filter.
 *
 * The entity list is the client catalogue rather than the Clear-all list: the
 * catalogue mirrors `admin_purge_filter_columns`, so a module is only offered
 * where the server has a filter spec, and a module whose spec has not been
 * written yet (rather than one that has none by nature) simply does not appear
 * instead of opening a dialog that can only say so.
 */
export function DataCleanupFilteredPanel() {
  const t = useTranslations("pages.settings.dataCleanup.filtered");
  const tCleanup = useTranslations("pages.settings.dataCleanup");
  const [entity, setEntity] = useState<string>(
    PURGE_FILTER_ENTITIES[0]?.entity ?? "drivers",
  );
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () =>
      PURGE_FILTER_ENTITIES.map((entry) => ({
        value: entry.entity,
        label: tCleanup(`modules.${entry.entity}` as "modules.drivers"),
      })),
    [tCleanup],
  );

  const columns = useMemo(
    () =>
      PURGE_FILTER_ENTITIES.find((entry) => entry.entity === entity)?.columns ?? [],
    [entity],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              {t("panelBannerTitle")}
            </p>
            <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/90">
              {t("panelBannerBody")}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              {t("panelModule")}
            </p>
            <Select
              items={items}
              value={entity}
              onValueChange={(value) => setEntity(value ?? entity)}
            >
              <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg">
                <SelectValue placeholder={t("panelModulePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="cursor-pointer">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 cursor-pointer rounded-lg"
            onClick={() => setOpen(true)}
          >
            <Filter className="h-4 w-4" />
            <span className="ms-1.5">{t("panelStart")}</span>
          </Button>
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium">{t("panelColumns")}</span>
          {columns.map((column) => (
            <span
              key={column.key}
              className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5"
            >
              {purgeFilterColumnLabel(t, entity, column.key)}
            </span>
          ))}
        </p>
      </div>

      <PurgeFilteredDialog open={open} onOpenChange={setOpen} entity={entity} />
    </div>
  );
}
