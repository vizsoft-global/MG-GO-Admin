"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import {
  INTERACTIVE_TILE,
  NEUTRAL_TILE,
  normalizeTone,
  SELECTED_TILE,
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
  compact = false,
  className,
  onClick,
  href,
  ariaLabel,
  disabled = false,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: Tone | string;
  selected?: boolean;
  trendPercent?: string;
  trendDirection?: "up" | "down";
  hint?: string;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
  /** Locale-relative path; the whole tile becomes a real link to the filtered view. */
  href?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const resolvedTone = normalizeTone(tone);
  const toneStyle = TONE_STYLES[resolvedTone];
  const TrendIcon = trendDirection === "up" ? ArrowUp : ArrowDown;
  const trendClass =
    trendDirection === "up" ? "text-success" : "text-danger";
  const interactive = Boolean(onClick || href) && !disabled;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || !onClick) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  };

  const content = (
    <>
      <div className="flex items-start justify-between gap-1.5">
        <p
          className={cn(
            "min-w-0 flex-1 font-semibold uppercase tracking-wide text-muted-foreground",
            compact ? "text-xs leading-tight" : "text-xs",
            selected && "text-orange-600",
          )}
        >
          {label}
        </p>
        {selected ? (
          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
            <Check className={compact ? "size-3" : "size-3.5"} aria-hidden />
          </span>
        ) : null}
        {Icon ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg",
              compact ? "size-7" : "size-9",
              toneStyle.iconChip,
            )}
            aria-hidden
          >
            <Icon className={compact ? "size-3.5" : "size-4"} />
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "mt-1 font-semibold tabular-nums tracking-tight text-foreground",
          compact ? "text-xl" : "text-2xl",
        )}
      >
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
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );

  const shellClass = cn(
    "min-w-0 overflow-hidden rounded-xl",
    compact ? "p-2.5" : "p-3",
    NEUTRAL_TILE,
    toneStyle.accentBar,
    interactive && INTERACTIVE_TILE,
    disabled && "cursor-not-allowed opacity-60",
    selected && SELECTED_TILE,
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel ?? label}
        aria-current={selected ? "true" : undefined}
        className={shellClass}
      >
        {content}
      </Link>
    );
  }

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      aria-disabled={disabled || undefined}
      onClick={interactive && onClick ? onClick : undefined}
      onKeyDown={handleKeyDown}
      className={shellClass}
    >
      {content}
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "solid" ? toneStyle.solidPill : toneStyle.softPill,
        className,
      )}
    >
      {children}
    </span>
  );
}
