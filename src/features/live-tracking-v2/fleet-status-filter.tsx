"use client";

/**
 * Status filtering as one control instead of eight chips.
 *
 * Seven status chips plus Alerts only cannot share a row with the search box and the zone
 * and partner selects, so the filter card wrapped to two or three rows and ate the top of
 * the map — on the surface where the map is the instrument. Collapsing the chips into a
 * dropdown gets the whole filter set onto one row and keeps the same semantics: a status
 * is a checkbox, Alerts only is the standalone filter it always was (see
 * `toggleFleetAlertsOnly`), and the count on the trigger is what the chips used to say by
 * being lit.
 *
 * Not `SearchSelect`: this is a fixed enum of seven with multiple selection, which that
 * component cannot express. Not `Select` either, for the same reason.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, TriangleAlert } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { FLEET_FILTER_STATUSES, fleetStatusTone, type FleetStatus } from "./fleet-status";
import { FLEET_TONE_DOT } from "./fleet-tone";
import type { FleetFilters } from "./fleet-types";

export function FleetStatusFilter({
  filters,
  onToggleStatus,
  onToggleAlertsOnly,
  onSetStatuses,
  className,
}: {
  filters: FleetFilters;
  onToggleStatus: (status: FleetStatus) => void;
  onToggleAlertsOnly: () => void;
  /** `null` restores "every status", which is not the same value as the full list. */
  onSetStatuses: (statuses: FleetStatus[] | null) => void;
  className?: string;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => (filters.alertsOnly ? [] : (filters.statuses ?? [...FLEET_FILTER_STATUSES])),
    [filters.alertsOnly, filters.statuses],
  );

  const narrowed = filters.alertsOnly || filters.statuses !== null;

  const label = filters.alertsOnly
    ? t("filters.alertsOnly")
    : selected.length === FLEET_FILTER_STATUSES.length
      ? t("filters.allStatuses")
      : selected.length === 0
        ? t("filters.noStatuses")
        : selected.length === 1
          ? t(`status.${selected[0]!}`)
          : t("filters.statusCount", { count: selected.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={t("filters.statuses")}
        className={cn(
          "flex h-9 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 text-sm shadow-xs transition-colors duration-150",
          // A narrowed filter is a selection, so it gets the same emerald the chips had:
          // an operator must be able to see at a glance that the map is not showing
          // everything, which was the one thing the chips did well.
          narrowed
            ? "border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 ring-1 ring-emerald-400/50"
            : "border-input bg-background text-muted-foreground hover:text-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>

      <PopoverContent className="w-[230px] p-1.5" align="start">
        <div className="flex items-center justify-between px-1.5 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("filters.statuses")}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="cursor-pointer rounded px-1 text-[11px] text-primary transition-colors duration-150 hover:bg-primary/10"
              onClick={() => onSetStatuses(null)}
            >
              {t("filters.selectAll")}
            </button>
            <button
              type="button"
              className="cursor-pointer rounded px-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted"
              onClick={() => onSetStatuses([])}
            >
              {t("filters.selectNone")}
            </button>
          </div>
        </div>

        <div className="flex flex-col">
          {FLEET_FILTER_STATUSES.map((status) => {
            const checked = selected.includes(status);
            return (
              <button
                key={status}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => onToggleStatus(status)}
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors duration-150",
                  checked
                    ? "bg-emerald-50 font-semibold text-emerald-900"
                    : "text-muted-foreground hover:bg-muted/70",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    FLEET_TONE_DOT[fleetStatusTone(status)],
                    !checked && "opacity-50",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{t(`status.${status}`)}</span>
                {checked ? (
                  <Check className="size-3.5 shrink-0 stroke-[2.5] text-emerald-600" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Alerts only replaces the status set rather than narrowing it, so it sits
            under a rule instead of in the list above. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={filters.alertsOnly}
          onClick={onToggleAlertsOnly}
          className={cn(
            "mt-1 flex h-8 cursor-pointer items-center gap-2 rounded-md border-t border-border px-1.5 pt-1 text-left text-xs transition-colors duration-150",
            filters.alertsOnly
              ? "bg-emerald-50 font-semibold text-emerald-900"
              : "text-muted-foreground hover:bg-muted/70",
          )}
        >
          <TriangleAlert
            className={cn("size-3 shrink-0", filters.alertsOnly ? "" : "opacity-50")}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{t("filters.alertsOnly")}</span>
          {filters.alertsOnly ? (
            <Check className="size-3.5 shrink-0 stroke-[2.5] text-emerald-600" aria-hidden />
          ) : null}
        </button>
      </PopoverContent>
    </Popover>
  );
}
