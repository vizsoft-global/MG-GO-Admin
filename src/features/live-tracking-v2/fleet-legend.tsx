"use client";

/**
 * Floating map legend.
 *
 * Statuses only. Flags are deliberately absent from the colour key because they do not
 * have colours on the map — an out-of-zone Moving driver stays an emerald pin and gains
 * a badge in the rail, which is the whole point of separating status from flags.
 * Location off is listed here even though it is rarer than Moving, because the rail
 * already shows it and a colour key that omits a live status fails the squint test.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLEET_FILTER_STATUSES, fleetStatusTone } from "./fleet-status";
import { FLEET_TONE_DOT } from "./fleet-tone";

export function FleetLegend() {
  const t = useTranslations("pages.liveTrackingV2");
  const [open, setOpen] = useState(true);

  return (
    <div className="fleet-overlay rounded-lg border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex h-7 w-full cursor-pointer items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3" aria-hidden />
        ) : (
          <ChevronUp className="size-3" aria-hidden />
        )}
        {t("legend.heading")}
      </button>

      {open ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-2 pb-2">
          {FLEET_FILTER_STATUSES.map((status) => (
            <span
              key={status}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span
                className={cn("size-2 rounded-full", FLEET_TONE_DOT[fleetStatusTone(status)])}
                aria-hidden
              />
              {t(`status.${status}`)}
            </span>
          ))}
          <span className="col-span-2 pt-1 text-[9px] leading-tight text-muted-foreground/80">
            {t("legend.flagsNote")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
