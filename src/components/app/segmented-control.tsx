"use client";

import { cn } from "@/lib/utils";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-[var(--gap-tight)]", className)} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              "h-9 rounded-[var(--radius-pill)] border px-3 text-sm transition-colors duration-150",
              selected
                ? "border-[var(--selected-navy)] bg-[var(--selected-navy)] font-semibold text-white"
                : "border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count != null ? <span className="ms-1 tabular-nums">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
