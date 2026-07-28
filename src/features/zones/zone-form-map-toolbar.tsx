"use client";

import { Trash2, Move, PenLine, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

export type ZoneMapTool = "draw" | "edit" | "move" | "delete" | "clear";
type VisibleZoneMapTool = Exclude<ZoneMapTool, "edit">;

const TOOL_ICON: Record<VisibleZoneMapTool, typeof PenLine> = {
  draw: PenLine,
  move: Move,
  delete: Trash2,
  clear: Eraser,
};

export function ZoneFormMapToolbar({
  activeTool,
  onToolChange,
  labels,
  tools = ["draw", "move", "delete", "clear"],
  className,
}: {
  activeTool: ZoneMapTool;
  onToolChange: (tool: ZoneMapTool) => void;
  labels: Partial<Record<VisibleZoneMapTool, string>>;
  tools?: VisibleZoneMapTool[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-md dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
      role="toolbar"
      aria-label="Map drawing tools"
    >
      {tools.map((tool) => {
        const Icon = TOOL_ICON[tool];
        const active = activeTool === tool;
        return (
          <button
            key={tool}
            type="button"
            onClick={() => onToolChange(tool)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{labels[tool] ?? tool}</span>
          </button>
        );
      })}
    </div>
  );
}
