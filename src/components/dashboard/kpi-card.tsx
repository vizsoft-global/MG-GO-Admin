import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  accentToTone,
  NEUTRAL_TILE,
  TONE_STYLES,
} from "@/lib/ui/tone-styles";
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
  layout?: "default" | "portal";
  portalAccent?: PortalKpiAccent;
}) {
  const toneStyle = TONE_STYLES[accentToTone(accent)];
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 overflow-hidden rounded-xl text-start",
        layout === "portal"
          ? "flex-col gap-1.5 border border-[var(--portal-border)] bg-[var(--portal-canvas)] px-5 py-[18px]"
          : compact
            ? "items-center gap-2 px-3 py-1.5"
            : "p-4",
        layout === "default" && NEUTRAL_TILE,
        layout === "default" && toneStyle.accentBar,
        onClick && "cursor-pointer",
        selected && (accent === "success" ? "ring-1 ring-success" : "ring-1 ring-primary"),
        className,
      )}
    >
      {layout === "portal" ? (
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
            toneStyle.iconChip,
          )}
        >
          <Icon className={compact ? "size-3.5" : "size-4"} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {compact ? (
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
              {value}
            </span>
            {caption ? (
              <span className="truncate text-xs text-muted-foreground">{caption}</span>
            ) : null}
          </p>
        ) : (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {value}
            </p>
            {caption ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{caption}</p>
            ) : null}
          </>
        )}
      </div>
      </>
      )}
    </Comp>
  );
}
