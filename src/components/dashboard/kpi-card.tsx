import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  accentToTone,
  NEUTRAL_TILE,
  TONE_STYLES,
} from "@/lib/ui/tone-styles";
import { cn } from "@/lib/utils";

export type KpiAccent = "default" | "success" | "warning" | "danger" | "primary";

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "default",
  caption,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: KpiAccent;
  caption?: ReactNode;
  className?: string;
}) {
  const toneStyle = TONE_STYLES[accentToTone(accent)];

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 overflow-hidden rounded-xl p-4",
        NEUTRAL_TILE,
        toneStyle.accentBar,
        className,
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
            toneStyle.iconChip,
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {caption ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{caption}</p>
        ) : null}
      </div>
    </div>
  );
}
