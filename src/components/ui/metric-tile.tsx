"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import {
  NEUTRAL_TILE,
  normalizeTone,
  TONE_STYLES,
  type Tone,
} from "@/lib/ui/tone-styles";
import { cn } from "@/lib/utils";

export type { Tone } from "@/lib/ui/tone-styles";
export { normalizeTone } from "@/lib/ui/tone-styles";

export function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  selected = false,
  trendPercent,
  trendDirection = "up",
  hint,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: Tone | string;
  selected?: boolean;
  trendPercent?: string;
  trendDirection?: "up" | "down";
  hint?: string;
  className?: string;
}) {
  const resolvedTone = normalizeTone(tone);
  const toneStyle = TONE_STYLES[resolvedTone];
  const TrendIcon = trendDirection === "up" ? ArrowUp : ArrowDown;
  const trendClass =
    trendDirection === "up" ? "text-success" : "text-danger";

  return (
    <article
      className={cn(
        "rounded-xl p-3",
        NEUTRAL_TILE,
        toneStyle.accentBar,
        selected && "ring-2 ring-primary/50 ring-offset-1 ring-offset-background",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
              toneStyle.iconChip,
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>

      {trendPercent ? (
        <p
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-xs font-medium tabular-nums",
            trendClass,
          )}
        >
          <TrendIcon className="size-3.5" />
          {trendPercent}
        </p>
      ) : null}

      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </article>
  );
}

export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: Tone | string;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[normalizeTone(tone)];
  return (
    <span
      className={cn("relative inline-flex size-2.5 shrink-0", className)}
      aria-hidden
    >
      <span className={cn("absolute inset-0 rounded-full opacity-25", toneStyle.dot)} />
      <span
        className={cn(
          "absolute inset-[2px] rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.55)]",
          toneStyle.dot,
        )}
      />
    </span>
  );
}

export function SignalBars({
  value,
  tone = "success",
  className,
}: {
  value: 0 | 1 | 2 | 3 | 4;
  tone?: Tone | string;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[normalizeTone(tone)];
  return (
    <span className={cn("inline-flex items-end gap-0.5", className)} aria-hidden>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn(
            "w-1 rounded-[2px] transition-colors duration-150",
            bar === 1 && "h-1.5",
            bar === 2 && "h-2.5",
            bar === 3 && "h-3.5",
            bar === 4 && "h-4.5",
            bar <= value ? toneStyle.signal : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
  variant = "soft",
  className,
}: {
  children: ReactNode;
  tone?: Tone | string;
  variant?: "soft" | "solid";
  className?: string;
}) {
  const toneStyle = TONE_STYLES[normalizeTone(tone)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        variant === "solid" ? toneStyle.solidPill : toneStyle.softPill,
        className,
      )}
    >
      {children}
    </span>
  );
}
