"use client";

/**
 * Which rail is feeding the page, and how stale it is.
 *
 * This is not decoration. "The map is ten seconds behind" and "the map is broken" are
 * different incidents with different responses, and the operator cannot tell them apart
 * from pin movement alone — a mirror-rail page looks identical to a live one until you
 * time it.
 */

import { useTranslations } from "next-intl";
import { Radio, Rss, RefreshCw, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLEET_TONE_DOT } from "./fleet-tone";
import { useFleetRailLabel } from "./use-fleet";
import type { FleetRail } from "./fleet-types";

const RAIL_ICON = {
  edge: Radio,
  mirror: Rss,
  poll: RefreshCw,
  offline: WifiOff,
} as const satisfies Record<FleetRail, unknown>;

export function FleetConnectionPill({ className }: { className?: string }) {
  const t = useTranslations("pages.liveTrackingV2.connection");
  const { rail, status, staleSeconds } = useFleetRailLabel();

  const Icon = RAIL_ICON[rail];
  const tone =
    status === "error"
      ? "danger"
      : status === "degraded"
        ? "warning"
        : rail === "edge"
          ? "success"
          : rail === "offline"
            ? "neutral"
            : "warning";

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 text-[10px] font-semibold text-muted-foreground",
        className,
      )}
      title={rail === "edge" ? undefined : t("hint")}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          FLEET_TONE_DOT[tone],
          status === "live" && "fleet-pulse",
        )}
        aria-hidden
      />
      <Icon className="size-3" aria-hidden />
      <span>{t(rail)}</span>
      {staleSeconds > 2 ? (
        <span className="tabular-nums text-muted-foreground/80">
          {t("updated", { seconds: staleSeconds })}
        </span>
      ) : null}
    </span>
  );
}
