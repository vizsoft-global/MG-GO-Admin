"use client";

import type { ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The V2 frames are drawn on a 1440px canvas with a 40px page inset. The
 * dashboard main element already carries `p-3`, so the surface cancels that
 * inset and re-applies the frame's own padding.
 */
export function V2Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("-m-3 min-h-[calc(100%+1.5rem)] bg-[var(--surface-page)]", className)}>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 xl:px-10 xl:py-7">{children}</div>
    </div>
  );
}

const TILE_TONE = {
  rust: "bg-[var(--accent-rust)] text-white",
  green: "bg-[var(--status-working-fg)] text-white",
  navy: "bg-[var(--selected-navy)] text-white",
} as const;

export type V2HeaderTone = keyof typeof TILE_TONE;

export function V2PageHeader({
  icon,
  tone = "rust",
  breadcrumbs,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  tone?: V2HeaderTone;
  breadcrumbs: readonly string[];
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <span
          className={cn("grid size-12 shrink-0 place-items-center rounded-xl", TILE_TONE[tone])}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <nav aria-label={title} className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
            {breadcrumbs.map((item, index) => (
              <span key={`${item}-${index}`} className="inline-flex items-center gap-1.5">
                {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                <span className={index === breadcrumbs.length - 1 ? "text-[var(--text-secondary)]" : undefined}>{item}</span>
              </span>
            ))}
          </nav>
          <h1 className="font-display mt-0.5 text-[26px] font-bold leading-8 tracking-tight text-[var(--text-primary)] sm:text-[30px] sm:leading-9">
            {title}
          </h1>
          {subtitle ? <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pt-4">{actions}</div> : null}
    </header>
  );
}

export function V2Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  return (
    <Tag className={cn("rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 xl:p-6", className)}>
      {children}
    </Tag>
  );
}

export function V2CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[18px] font-bold leading-6 text-[var(--text-primary)]">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] leading-4 text-[var(--text-secondary)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The small dot + label used by every KPI and legend in the frames. */
export function DotLabel({
  tone = "neutral",
  children,
  className,
}: {
  tone?: V2Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]", className)}>
      <span className={cn("size-2 shrink-0 rounded-[2px]", TONE_DOT[tone])} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

export type V2Tone = "ink" | "working" | "leave" | "sick" | "absent" | "neutral" | "accident" | "ochre" | "rust";

export const TONE_DOT: Record<V2Tone, string> = {
  ink: "bg-[var(--selected-navy)]",
  working: "bg-[var(--status-working-fg)]",
  leave: "bg-[var(--status-leave-fg)]",
  sick: "bg-[var(--status-sick-fg)]",
  absent: "bg-[var(--status-absent-fg)]",
  neutral: "bg-[var(--status-neutral-fg)]",
  accident: "bg-[var(--status-accident-fg)]",
  ochre: "bg-[var(--status-sick-fg)]",
  rust: "bg-[var(--accent-rust)]",
};

export const TONE_FILL: Record<V2Tone, string> = {
  ink: "bg-[var(--selected-navy)]",
  working: "bg-[var(--status-working-fg)]",
  leave: "bg-[var(--status-leave-fg)]",
  sick: "bg-[var(--status-sick-fg)]",
  absent: "bg-[var(--status-absent-fg)]",
  neutral: "bg-[var(--status-neutral-fg)]",
  accident: "bg-[var(--status-accident-fg)]",
  ochre: "bg-[var(--status-sick-fg)]",
  rust: "bg-[var(--accent-rust)]",
};

/** A stat box inside a card — 8px dot, 28px value, 12px caption. */
export function V2Stat({
  label,
  value,
  caption,
  tone = "ink",
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: V2Tone;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] px-4 py-3.5", className)}>
      <DotLabel tone={tone}>{label}</DotLabel>
      <p className="font-display mt-1.5 text-[24px] font-bold leading-8 tabular-nums text-[var(--text-primary)]">{value}</p>
      {caption ? <p className="mt-0.5 text-xs leading-4 text-[var(--text-secondary)]">{caption}</p> : null}
    </div>
  );
}

export function V2Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs leading-[18px]",
        tone === "green"
          ? "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]"
          : "bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

export type MonthBarItem = {
  key: string;
  label: string;
  value: number;
  tone: "past" | "current" | "future" | "gold";
  selected?: boolean;
};

/** The vertical month bars shared by the Rider Operations leave planner and the client dashboard. */
export function MonthBars({
  items,
  height = 150,
  onSelect,
  showValue = true,
  className,
}: {
  items: readonly MonthBarItem[];
  height?: number;
  onSelect?: (key: string) => void;
  showValue?: boolean;
  className?: string;
}) {
  const peak = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className={cn("flex items-end gap-2 sm:gap-3", className)}>
      {items.map((item) => {
        const barHeight = item.value <= 0 ? 6 : Math.max(10, Math.round((item.value / peak) * height));
        const future = item.tone === "future";
        return (
          <button
            key={item.key}
            type="button"
            onClick={onSelect ? () => onSelect(item.key) : undefined}
            disabled={!onSelect}
            aria-pressed={onSelect ? item.selected : undefined}
            className={cn(
              "group flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center",
              onSelect ? "cursor-pointer" : "cursor-default",
            )}
          >
            {showValue ? (
              <span className="font-display text-[13px] font-semibold leading-4 tabular-nums text-[var(--text-primary)]">
                {item.value}
              </span>
            ) : null}
            <span className="flex w-full items-end justify-center" style={{ height }}>
              <span
                className={cn(
                  "w-full max-w-[56px] rounded-t-[6px] transition-[filter] duration-150",
                  item.tone === "past" && "bg-[var(--selected-navy)]",
                  item.tone === "current" && "bg-[var(--accent-rust)]",
                  item.tone === "gold" && "bg-[var(--status-sick-fg)]",
                  future && "border border-dashed border-[#c9c3cc] bg-transparent",
                  item.selected && "ring-2 ring-[var(--selected-navy)] ring-offset-2 ring-offset-[var(--surface-card)]",
                  onSelect && "group-hover:brightness-105",
                )}
                style={{ height: `${barHeight}px` }}
              />
            </span>
            <span className="truncate text-xs leading-4 text-[var(--text-secondary)]">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function V2TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function V2Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-[var(--text-secondary)]">{children}</p>;
}

