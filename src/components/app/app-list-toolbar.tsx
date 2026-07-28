import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute end-1 top-1/2 h-7 w-7 -translate-y-1/2 cursor-pointer"
                onClick={() => onSearchChange("")}
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Clear</span>
              </Button>
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
