"use client";

/**
 * The live event feed.
 *
 * Follows the pause semantics of the v1 Activity view: pausing does not drop events, it
 * holds them and shows an "N new" pill, because an operator reading a row must be able
 * to finish reading it without the list jumping — but must never be able to *miss*
 * events by pausing.
 *
 * Class A (audited, from `driver_operation_events`) and Class B (derived, from
 * `fleet_events`) share the timeline but are labelled, because "the server recorded this"
 * and "the edge inferred this" carry different weight in an incident review.
 */

import { useTranslations } from "next-intl";
import { Pause, Play, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { fleetEventTone } from "./fleet-status";
import { FLEET_TONE_DOT } from "./fleet-tone";
import { eventTakesValue, humaniseEventKey, isTranslatedEventKey } from "./fleet-event-labels";
import { useFleetSnapshot, useFleetStore } from "./use-fleet";
import type { FleetFeedItem } from "./fleet-types";

function formatClock(atMs: number): string {
  const date = new Date(atMs);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function FleetEventFeed() {
  const t = useTranslations("pages.liveTrackingV2");
  const store = useFleetStore();
  const snapshot = useFleetSnapshot();

  const selectedId = snapshot.selectedDriverId;
  const items = selectedId
    ? snapshot.feed.filter((item) => item.driverId === selectedId)
    : snapshot.feed;

  const selectedName = selectedId
    ? (store.getDriver(selectedId)?.meta.driverName ?? null)
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-2">
        <Radio className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("feed.heading")}
        </span>

        {snapshot.feedPaused && snapshot.pendingFeedCount > 0 ? (
          <button
            type="button"
            onClick={() => store.setFeedPaused(false)}
            className="ms-1 cursor-pointer rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[9px] font-semibold text-amber-800 transition-colors duration-150 hover:bg-amber-100"
          >
            {t("feed.new", { count: snapshot.pendingFeedCount })}
          </button>
        ) : null}

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ms-auto size-6"
          aria-label={snapshot.feedPaused ? t("feed.resume") : t("feed.pause")}
          aria-pressed={snapshot.feedPaused}
          onClick={() => store.setFeedPaused(!snapshot.feedPaused)}
        >
          {snapshot.feedPaused ? (
            <Play className="size-3" aria-hidden />
          ) : (
            <Pause className="size-3" aria-hidden />
          )}
        </Button>
      </div>

      {selectedId ? (
        <div className="flex items-center justify-between gap-1 px-2 pb-1">
          <span className="truncate text-[10px] text-muted-foreground">
            {t("feed.forDriver", { name: selectedName ?? selectedId })}
          </span>
          <button
            type="button"
            onClick={() => store.clearSelection()}
            className="shrink-0 cursor-pointer rounded px-1 text-[10px] font-medium text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            {t("feed.clearFilter")}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-[11px] font-medium">{t("feed.empty")}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("feed.emptyHint")}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} showDriver={!selectedId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedRow({ item, showDriver }: { item: FleetFeedItem; showDriver: boolean }) {
  const t = useTranslations("pages.liveTrackingV2");
  const tone = fleetEventTone(item.severity);

  const label = isTranslatedEventKey(item.eventKey)
    ? t(
        `events.${item.eventKey}` as never,
        eventTakesValue(item.eventKey)
          ? ({ value: item.value ?? 0 } as never)
          : (undefined as never),
      )
    : humaniseEventKey(item.eventKey);

  return (
    <li
      data-severity={item.severity}
      className="fleet-feed-row flex items-start gap-1.5 rounded px-1 py-1"
    >
      <span
        className={cn("mt-1 size-1.5 shrink-0 rounded-full", FLEET_TONE_DOT[tone])}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-tight">
          {label}
          {item.success === false && item.errorCode ? (
            <span className="ms-1 text-rose-700">({item.errorCode})</span>
          ) : null}
        </p>
        <p className="flex items-center gap-1 text-[9px] leading-tight text-muted-foreground">
          {showDriver && item.driverName ? (
            <span className="truncate">{item.driverName}</span>
          ) : null}
          <span className="tabular-nums">{formatClock(item.atMs)}</span>
          <span className="rounded border border-border/60 px-0.5 uppercase">
            {item.kind === "ops" ? t("feed.classOps") : t("feed.classFleet")}
          </span>
        </p>
      </div>
    </li>
  );
}
