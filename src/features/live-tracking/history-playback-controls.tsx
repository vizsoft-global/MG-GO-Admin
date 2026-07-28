"use client";

import { useTranslations } from "next-intl";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrackingGlassCard } from "./tracking-shell";

const SPEEDS = [1, 2, 4] as const;

export function HistoryPlaybackControls({
  playing,
  onTogglePlay,
  onRestart,
  speed,
  onSpeedChange,
  index,
  maxIndex,
  onIndexChange,
  currentLabel,
  durationLabel,
  deliverySubmitIndices = [],
}: {
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  index: number;
  maxIndex: number;
  onIndexChange: (index: number) => void;
  currentLabel: string;
  durationLabel: string;
  deliverySubmitIndices?: number[];
}) {
  const t = useTranslations("pages.liveTracking");
  const disabled = maxIndex < 0;
  const pointCount = Math.max(maxIndex + 1, 0);
  const pointLabel = `${Math.min(index + 1, pointCount)}/${pointCount}`;

  return (
    <TrackingGlassCard className="w-[min(340px,calc(100vw-2rem))] space-y-2 border-border/80 bg-card/95 p-2.5 shadow-md">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg"
          onClick={onTogglePlay}
          disabled={disabled}
          title={playing ? t("playbackPause") : t("playbackPlay")}
          aria-label={playing ? t("playbackPause") : t("playbackPlay")}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg"
          onClick={onRestart}
          disabled={disabled}
          title={t("historyRestart")}
          aria-label={t("historyRestart")}
        >
          <RotateCcw className="size-3.5" />
        </Button>

        <div
          className="inline-flex shrink-0 items-center rounded-lg border border-border bg-muted/40 p-0.5"
          role="group"
          aria-label={t("playbackSpeed")}
        >
          {SPEEDS.map((value) => {
            const selected = speed === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onSpeedChange(value)}
                disabled={disabled}
                className={cn(
                  "min-w-[2rem] cursor-pointer rounded-md px-2 py-1 text-[10px] font-semibold tabular-nums transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {value}x
              </button>
            );
          })}
        </div>

        <div className="ms-auto min-w-0 text-end">
          <p className="truncate text-[11px] font-semibold tabular-nums text-foreground">
            {currentLabel}
          </p>
          <p className="truncate text-[10px] tabular-nums text-muted-foreground">
            {pointLabel} · {durationLabel}
          </p>
        </div>
      </div>

      <div className="relative px-0.5">
        <input
          type="range"
          min={0}
          max={Math.max(0, maxIndex)}
          step={1}
          value={index}
          disabled={disabled}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          aria-label={t("playbackCurrent")}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-3 [&::-moz-range-track]:h-1.5 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-runnable-track]:h-1.5"
        />
        {maxIndex > 0 ? (
          <div className="pointer-events-none absolute inset-x-0.5 top-0 h-1.5">
            {deliverySubmitIndices.map((eventIndex) => {
              const leftPercent = (eventIndex / maxIndex) * 100;
              return (
                <span
                  key={eventIndex}
                  className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 shadow-sm ring-1 ring-background"
                  style={{ left: `${leftPercent}%` }}
                  title={t("deliverySubmitMarker")}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </TrackingGlassCard>
  );
}
