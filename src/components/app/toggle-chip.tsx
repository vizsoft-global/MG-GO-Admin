"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Selected = emerald green (high contrast). Unselected = muted outline. */
export function ToggleChip({
  selected,
  onClick,
  disabled,
  icon: Icon,
  leading,
  children,
  className,
  size = "sm",
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
  leading?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const sizeClass =
    size === "md" ? "h-8 gap-1.5 px-2.5 text-xs" : "h-7 gap-1 px-2 text-[11px]";

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
        sizeClass,
        selected
          ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
          : "border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/50 hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {leading ? (
        <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center overflow-hidden rounded-sm">
          {leading}
        </span>
      ) : Icon ? (
        <Icon
          className={cn("h-3 w-3 shrink-0", selected ? "text-emerald-900" : "opacity-50")}
          aria-hidden
        />
      ) : selected ? (
        <Check className="h-3 w-3 shrink-0 stroke-[2.5]" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/** Single-choice segment (e.g. Active / Inactive). Active option uses emerald when selected. */
export function SegmentOption({
  selected,
  onClick,
  disabled,
  children,
  variant = "default",
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: "success" | "default";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border text-xs font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
        selected && variant === "success"
          ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
          : selected
            ? "border-primary bg-primary/15 text-primary ring-1 ring-primary/30"
            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {selected && variant === "success" ? <Check className="h-3 w-3 stroke-[2.5]" /> : null}
      {children}
    </button>
  );
}
