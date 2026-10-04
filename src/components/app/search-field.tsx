"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The compact list search box: a leading magnifier, an `h-9` input, and a
 * trailing clear button that appears only once there is something to clear.
 *
 * Every list in the panel had grown its own copy of this markup and most had
 * lost the clear button on the way, which left an operator who mistyped a name
 * with no way back except selecting the text by hand. One component keeps the
 * behaviour identical everywhere and makes "clear search" a property of the
 * control rather than something each page remembers.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
  inputClassName,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name for the clear button. */
  clearLabel: string;
  className?: string;
  inputClassName?: string;
} & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "placeholder" | "className"
>) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...rest}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn("h-9 rounded-lg bg-background ps-8 pe-8 text-xs", inputClassName)}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute end-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={clearLabel}
          title={clearLabel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
