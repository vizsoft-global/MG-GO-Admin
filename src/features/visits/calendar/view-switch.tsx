"use client";

import { cn } from "@/lib/utils";

export type CalendarViewMode = "day" | "week" | "month" | "year";

type ViewSwitchProps = {
  mode: CalendarViewMode;
  onChange: (mode: CalendarViewMode) => void;
  labels: { day: string; week: string; month: string; year: string };
};

const MODES = ["day", "week", "month", "year"] as const;

function modeLabel(mode: CalendarViewMode, labels: ViewSwitchProps["labels"]): string {
  switch (mode) {
    case "day":
      return labels.day;
    case "week":
      return labels.week;
    case "month":
      return labels.month;
    case "year":
      return labels.year;
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

export function ViewSwitch({ mode, onChange, labels }: ViewSwitchProps) {
  return (
    <div className="inline-flex h-9 rounded-lg bg-muted/30 p-0.5" role="group">
      {MODES.map((item) => {
        const selected = mode === item;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(item)}
            className={cn(
              "h-8 rounded-md px-2.5 text-xs",
              selected ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-muted-foreground",
            )}
          >
            {modeLabel(item, labels)}
          </button>
        );
      })}
    </div>
  );
}
