"use client";

import { Trash2, Move, PenLine, Eraser, Hexagon, Paintbrush } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { cn } from "@/lib/utils";
import type { H3BlockSize } from "@/lib/geo/h3-blocks";
import type { ZoneBlockPaintMode } from "./zone-blocks-layer";

export type ZoneMapTool = "draw" | "blocks" | "edit" | "move" | "delete" | "clear";
type VisibleZoneMapTool = Exclude<ZoneMapTool, "edit">;

const TOOL_ICON: Record<VisibleZoneMapTool, typeof PenLine> = {
  draw: PenLine,
  blocks: Hexagon,
  move: Move,
  delete: Trash2,
  clear: Eraser,
};

const BLOCK_SIZES: H3BlockSize[] = ["S", "M", "L"];

export function ZoneFormMapToolbar({
  activeTool,
  onToolChange,
  labels,
  tools = ["draw", "move", "delete", "clear"],
  className,
  blockSize = "M",
  onBlockSizeChange,
  blockPaintMode = "paint",
  onBlockPaintModeChange,
  blockSizeLabels,
  blockPaintLabels,
}: {
  activeTool: ZoneMapTool;
  onToolChange: (tool: ZoneMapTool) => void;
  labels: Partial<Record<VisibleZoneMapTool, string>>;
  tools?: VisibleZoneMapTool[];
  className?: string;
  blockSize?: H3BlockSize;
  onBlockSizeChange?: (size: H3BlockSize) => void;
  blockPaintMode?: ZoneBlockPaintMode;
  onBlockPaintModeChange?: (mode: ZoneBlockPaintMode) => void;
  blockSizeLabels?: Record<H3BlockSize, string>;
  blockPaintLabels?: Record<ZoneBlockPaintMode, string>;
}) {
  const showBlockChips = activeTool === "blocks";

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
                ? "border border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
            )}
          >
            <Icon className={cn("h-4 w-4", active ? "text-emerald-900" : undefined)} />
            <span>{labels[tool] ?? tool}</span>
          </button>
        );
      })}
      {showBlockChips ? (
        <>
          <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
          {BLOCK_SIZES.map((size) => (
            <ToggleChip
              key={size}
              selected={blockSize === size}
              onClick={() => onBlockSizeChange?.(size)}
              className="h-9 px-2.5 text-xs"
            >
              {blockSizeLabels?.[size] ?? size}
            </ToggleChip>
          ))}
          <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
          <ToggleChip
            selected={blockPaintMode === "paint"}
            onClick={() => onBlockPaintModeChange?.("paint")}
            icon={Paintbrush}
            className="h-9 px-2.5 text-xs"
          >
            {blockPaintLabels?.paint ?? "Paint"}
          </ToggleChip>
          <ToggleChip
            selected={blockPaintMode === "erase"}
            onClick={() => onBlockPaintModeChange?.("erase")}
            icon={Eraser}
            className="h-9 px-2.5 text-xs"
          >
            {blockPaintLabels?.erase ?? "Erase"}
          </ToggleChip>
        </>
      ) : null}
    </div>
  );
}
