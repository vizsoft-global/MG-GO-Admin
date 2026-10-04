import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AppListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filterSlot,
  countLabel,
  trailing,
  className,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filterSlot?: ReactNode;
  countLabel?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const showSearch = onSearchChange !== undefined;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {showSearch ? (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 rounded-lg ps-9 pe-9"
            />
            {searchValue ? (
              // A plain button, not the shared Button: its base class carries
              // `active:translate-y-px`, which fights the `-translate-y-1/2`
              // centring and makes the X visibly jump out of the input while
              // pressed. `z-10` keeps it above the field at any width.
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear"
                className="absolute end-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
        {filterSlot}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {countLabel ? (
          <span className="text-xs text-muted-foreground">{countLabel}</span>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}
