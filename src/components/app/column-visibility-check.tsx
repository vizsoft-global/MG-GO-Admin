"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The square visibility checkbox every "Show and reorder columns" panel draws.
 *
 * One component because the panels had drifted: the payroll sheets drew a
 * bordered square, while the shared picker relied on a menu item's built-in
 * indicator, which paints a floating tick on the trailing edge and nothing at
 * all on a hidden column. A trailing tick also puts the state on the far side of
 * the label from the drag handle, so a long list has to be read twice.
 *
 * Placement is part of the contract: the caller renders this **between** the drag
 * handle and the label, so the eye reads handle → state → name → arrows.
 *
 * `uncheckedClassName` exists for the payroll sheets, which shipped a filled
 * unchecked square and are left exactly as they were.
 */
export function ColumnVisibilityCheck({
  checked,
  locked = false,
  onToggle,
  label,
  size = "sm",
  uncheckedClassName = "border-muted-foreground/60 bg-transparent",
  className,
}: {
  checked: boolean;
  /** A required column: shown, checked, and not clickable. */
  locked?: boolean;
  onToggle: () => void;
  /** Accessible name, e.g. "Hide column Name". */
  label: string;
  /** `sm` is `w-4 h-4` (the standard panel); `md` is `w-5 h-5` (the payroll sheets). */
  size?: "sm" | "md";
  uncheckedClassName?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={locked || undefined}
      disabled={locked}
      onClick={(event) => {
        // The row is not a menu item, but it sits inside one on some panels:
        // never let the tick bubble up and close the panel or move a row.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] border transition-colors",
        size === "md" ? "size-5" : "size-4",
        checked
          ? "border-emerald-500 bg-emerald-500 text-white"
          : cn("text-transparent", uncheckedClassName),
        locked ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        className,
      )}
    >
      <Check className="size-3" aria-hidden />
    </button>
  );
}
