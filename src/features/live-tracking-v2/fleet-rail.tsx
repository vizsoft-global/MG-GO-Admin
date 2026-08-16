"use client";

/**
 * The floating driver rail.
 *
 * Virtualized, because 500 cards each holding a store subscription is 500 subscriptions
 * whether or not they are on screen — with `@tanstack/react-virtual` only the ~8 visible
 * cards are mounted, so only those 8 are woken by a position frame.
 *
 * Collapses to a 48px icon strip rather than disappearing, so the operator can hand the
 * full width to the map without losing the fleet count.
 */

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { FleetDriverCard } from "./fleet-driver-card";
import { FLEET_TONE_DOT } from "./fleet-tone";
import { fleetStatusTone } from "./fleet-status";
import { useFleetSnapshot, useFleetStore } from "./use-fleet";

/**
 * Starting guess only — rows are measured after mount.
 *
 * A card is not a fixed height: the flag badges run zero to two lines, and the route
 * progress bar exists only for a driver with deliveries today. Pinning every row to one
 * number made a card with progress overflow its slot, and the next card's opaque
 * background then covered its footer, taking "View details" with it.
 */
const CARD_ESTIMATE = 132;
const CARD_GAP = 6;

export function FleetRail({
  onFocusDriver,
  collapsed,
  onCollapsedChange,
}: {
  onFocusDriver: (driverId: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const store = useFleetStore();
  const snapshot = useFleetSnapshot();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isCollapsed = collapsed ?? false;
  const driverIds = snapshot.driverIds;

  const virtualizer = useVirtualizer({
    count: driverIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE + CARD_GAP,
    overscan: 4,
  });

  const statusDots = useMemo(() => {
    // A tiny status ribbon for the collapsed strip: enough to tell an operator that
    // something is wrong without expanding the rail.
    const counts = snapshot.counts;
    return [
      { key: "moving", tone: fleetStatusTone("moving"), count: counts.moving },
      { key: "on_delivery", tone: fleetStatusTone("on_delivery"), count: counts.on_delivery },
      { key: "idle", tone: fleetStatusTone("idle"), count: counts.idle },
      { key: "alert", tone: "danger" as const, count: counts.alert },
    ];
  }, [snapshot.counts]);

  if (isCollapsed) {
    return (
      <div className="fleet-overlay pointer-events-auto flex w-12 flex-col items-center gap-2 rounded-xl border p-1.5 shadow-sm">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t("rail.expand")}
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <span className="flex flex-col items-center gap-0.5 text-[10px] font-semibold tabular-nums">
          <Users className="size-3.5 text-muted-foreground" aria-hidden />
          {driverIds.length}
        </span>
        <div className="flex flex-col items-center gap-1 pt-1">
          {statusDots.map((entry) => (
            <span key={entry.key} className="flex flex-col items-center">
              <span className={cn("size-2 rounded-full", FLEET_TONE_DOT[entry.tone])} aria-hidden />
              <span className="text-[9px] tabular-nums text-muted-foreground">{entry.count}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fleet-overlay pointer-events-auto flex w-[300px] flex-col rounded-xl border shadow-sm">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <Users className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-semibold">{t("rail.heading")}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {t("rail.showing", { visible: driverIds.length, total: snapshot.totalDrivers })}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ms-auto size-7"
          aria-label={t("rail.collapse")}
          onClick={() => onCollapsedChange?.(true)}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
      </div>

      {driverIds.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium">{t("rail.empty")}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("rail.emptyHint")}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const driverId = driverIds[item.index];
              if (!driverId) return null;
              return (
                // Keyed by slot, not by driver: `measureElement` caches against
                // `data-index`, so a node whose driver changes while its index stays put
                // keeps a measurement that still describes it.
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  // The gap sits *inside* the measured box, so the measurement and
                  // `estimateSize` describe the same thing.
                  className="absolute inset-x-0 top-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <FleetDriverCard
                    driverId={driverId}
                    selected={driverId === snapshot.selectedDriverId}
                    onSelect={(id) => {
                      // Same-marker click deselects (§12); same-row click re-zooms.
                      if (snapshot.selectedDriverId === id) {
                        onFocusDriver(id);
                        return;
                      }
                      store.selectDriver(id);
                    }}
                    onFocus={onFocusDriver}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
