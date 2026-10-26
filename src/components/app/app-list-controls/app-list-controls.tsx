"use client";

import type { ReactNode } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentOption } from "@/components/app/toggle-chip";
import { cn } from "@/lib/utils";
import type { ListGroupByOption, ListViewMode } from "./types";
import { searchClearVisible } from "./search-match";

export function AppListControls({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  clearSearchLabel,
  groupByOptions,
  groupBy,
  onGroupByChange,
  groupByLabel,
  viewMode,
  onViewModeChange,
  tableViewLabel,
  cardsViewLabel,
  filterSlot,
  trailing,
  singleRow,
  className,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  clearSearchLabel?: string;
  groupByOptions?: readonly ListGroupByOption[];
  groupBy?: string;
  onGroupByChange?: (value: string) => void;
  groupByLabel?: string;
  viewMode?: ListViewMode;
  onViewModeChange?: (value: ListViewMode) => void;
  tableViewLabel?: string;
  cardsViewLabel?: string;
  filterSlot?: ReactNode;
  trailing?: ReactNode;
  /** Keep search, filters, group and view on one line. */
  singleRow?: boolean;
  className?: string;
}) {
  const showSearch = onSearchChange !== undefined;
  const groups = groupByOptions ?? [];

  return (
    <div
      className={cn(
        singleRow ? "flex min-w-0 flex-nowrap items-center gap-2" : "flex flex-col gap-2 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          singleRow ? "min-w-0 flex-1 flex-nowrap" : "min-w-0 flex-1 flex-wrap",
        )}
      >
        {showSearch ? (
          <div className={cn("relative", singleRow ? "min-w-[140px] w-full max-w-[220px]" : "min-w-0 flex-1 sm:max-w-xs")}>
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 rounded-lg bg-background ps-8 pe-8 text-xs"
              aria-label={searchAriaLabel ?? searchPlaceholder}
            />
            {searchClearVisible(searchValue) ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute end-1.5 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={clearSearchLabel ?? "Clear"}
                title={clearSearchLabel ?? "Clear"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {filterSlot}

        {groups.length > 0 && onGroupByChange ? (
          <Select
            items={groups.map((item) => ({ value: item.value, label: item.label }))}
            value={groupBy ?? "none"}
            onValueChange={(value) => {
              if (value) onGroupByChange(value);
            }}
          >
            <SelectTrigger
              className={cn(
                "h-9 shrink-0 cursor-pointer rounded-lg text-xs",
                singleRow ? "w-[132px]" : "w-[148px]",
              )}
              aria-label={groupByLabel}
            >
              <SelectValue placeholder={groupByLabel} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((item) => (
                <SelectItem key={item.value} value={item.value} className="cursor-pointer">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {onViewModeChange ? (
          <div className="inline-flex h-9 items-center gap-1" role="group" aria-label={tableViewLabel}>
            <SegmentOption
              selected={(viewMode ?? "table") === "table"}
              onClick={() => onViewModeChange("table")}
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{tableViewLabel}</span>
            </SegmentOption>
            <SegmentOption
              selected={viewMode === "cards"}
              onClick={() => onViewModeChange("cards")}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{cardsViewLabel}</span>
            </SegmentOption>
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            singleRow ? "ms-auto flex-nowrap" : "flex-wrap",
          )}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
