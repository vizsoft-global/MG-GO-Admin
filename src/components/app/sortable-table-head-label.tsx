"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SortableTableHeadLabel({
  label,
  direction,
  onSort,
  className,
}: {
  label: string;
  direction: "asc" | "desc" | false;
  onSort: () => void;
  className?: string;
}) {
  const Icon =
    direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={onSort}
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : "none"
      }
      className={cn(
        "inline-flex h-9 max-w-full items-center gap-1 rounded-md px-0 text-left",
        "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.97] transition-colors duration-150",
        direction && "text-foreground",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          direction ? "text-foreground opacity-100" : "opacity-60",
        )}
        aria-hidden
      />
    </button>
  );
}
