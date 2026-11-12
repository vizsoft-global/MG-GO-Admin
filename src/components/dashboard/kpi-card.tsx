import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  accentToTone,
  NEUTRAL_TILE,
  TONE_STYLES,
} from "@/lib/ui/tone-styles";
import { isZeroMetricValue } from "@/lib/ui/kpi-zero";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type KpiAccent = "default" | "success" | "warning" | "danger" | "primary";

export type PortalKpiAccent = "ink" | "green" | "blue" | "red" | "ochre" | "grey" | "plum";

const PORTAL_ACCENT: Record<PortalKpiAccent, string> = {
  ink: "bg-[var(--portal-ink)]",
  green: "bg-[var(--portal-badge-green-fg)]",
  blue: "bg-[var(--portal-badge-blue-fg)]",
  red: "bg-[var(--portal-badge-red-fg)]",
  ochre: "bg-[var(--portal-badge-ochre-fg)]",
  grey: "bg-[var(--portal-badge-grey-fg)]",
  plum: "bg-[var(--portal-badge-plum-fg)]",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "default",
  caption,
  className,
  compact = false,
  selected = false,
  onClick,
  href,
  empty,
  layout = "default",
  portalAccent = "ink",
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: KpiAccent;
  caption?: ReactNode;
  className?: string;
  /** Reads the caption beside the value instead of below it, for KPI strips that
   *  share a viewport with a table or charts. */
  compact?: boolean;
  selected?: boolean;
  onClick?: () => void;
  /** When set the whole card is a real link, so it can be opened in a new tab. */
  href?: string;
  /** Overrides the automatic zero detection for interactive cards. */
  empty?: boolean;
  layout?: "default" | "portal";
  portalAccent?: PortalKpiAccent;
}) {
  const toneStyle = TONE_STYLES[accentToTone(accent)];
  const interactive = Boolean(onClick || href);
  const isEmpty = empty ?? (interactive && isZeroMetricValue(value));

  const shellClass = cn(
    "group relative flex items-start gap-3 overflow-hidden rounded-xl text-start",
    layout === "portal"
      ? "flex-col gap-1.5 border border-[var(--portal-border)] bg-[var(--portal-canvas)] px-5 py-[18px]"
      : compact
        ? "items-center gap-2 px-3 py-1.5"
        : "p-4",
    layout === "default" && NEUTRAL_TILE,
    layout === "default" && !isEmpty && toneStyle.accentBar,
    interactive && "cursor-pointer",
    interactive &&
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    isEmpty &&
      "border-dashed border-border bg-muted/20 hover:border-border hover:bg-muted/20",
    !isEmpty && selected && (accent === "success" ? "ring-1 ring-success" : "ring-1 ring-primary"),
    className,
  );

  const body =
    layout === "portal" ? (
      <>
        <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--portal-muted)]">
          <span className={cn("size-2 shrink-0 rounded-[2px]", PORTAL_ACCENT[portalAccent])} />
          {label}
        </p>
        <p className="text-[28px] leading-[34px] font-bold tabular-nums text-[var(--portal-ink)]">{value}</p>
        {caption ? <p className="text-xs text-[var(--portal-muted)]">{caption}</p> : null}
      </>
    ) : (
      <>
        {Icon ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg",
              compact ? "size-7" : "size-9",
              isEmpty ? "bg-muted text-muted-foreground" : toneStyle.iconChip,
            )}
          >
            <Icon className={compact ? "size-3.5" : "size-4"} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="whitespace-normal break-words text-xs font-semibold text-muted-foreground">
                  {label}
                </p>
              }
            />
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
          {compact ? (
            <p className="flex min-w-0 items-baseline gap-1.5">
              <span
                data-kpi-value
                className={cn(
                  "text-xl font-semibold tabular-nums tracking-tight",
                  isEmpty ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {value}
              </span>
              {caption ? (
                <span className="truncate text-xs text-muted-foreground">{caption}</span>
              ) : null}
            </p>
          ) : (
            <>
              <p
                data-kpi-value
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                  isEmpty ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {value}
              </p>
              {caption ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{caption}</p>
              ) : null}
            </>
          )}
        </div>
      </>
    );

  if (href) {
    return (
      <Link
        href={href}
        className={shellClass}
        data-empty={isEmpty ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
      >
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={shellClass}
        data-empty={isEmpty ? "true" : undefined}
        aria-pressed={selected}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={shellClass} data-empty={isEmpty ? "true" : undefined}>
      {body}
    </div>
  );
}
