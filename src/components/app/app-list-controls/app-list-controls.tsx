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
import type { ListGroupByOption, ListSearchFieldOption, ListViewMode } from "./types";

export function AppListControls({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  clearSearchLabel,
  searchFields,
  searchField,
  onSearchFieldChange,
  searchFieldLabel,
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
  className,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  clearSearchLabel?: string;
  searchFields?: readonly ListSearchFieldOption[];
  searchField?: string;
  onSearchFieldChange?: (value: string) => void;
  searchFieldLabel?: string;
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
  className?: string;
}) {
  const showSearch = onSearchChange !== undefined;
  const fields = searchFields ?? [];
  const groups = groupByOptions ?? [];

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {fields.length > 0 && onSearchFieldChange ? (
          <Select
            items={fields.map((item) => ({ value: item.value, label: item.label }))}
            value={searchField ?? "all"}
            onValueChange={(value) => {
              if (value) onSearchFieldChange(value);
            }}
          >
            <SelectTrigger
              className="h-9 w-[148px] shrink-0 cursor-pointer rounded-lg text-xs"
              aria-label={searchFieldLabel}
            >
              <SelectValue placeholder={searchFieldLabel} />
            </SelectTrigger>
            <SelectContent>
              {fields.map((item) => (
                <SelectItem key={item.value} value={item.value} className="cursor-pointer">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {showSearch ? (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 rounded-lg bg-background ps-8 pe-8 text-xs"
              aria-label={searchAriaLabel ?? searchPlaceholder}
            />
            {searchValue ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute end-1.5 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label={clearSearchLabel ?? "Clear"}
              >
                <X className="h-3 w-3" />
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
              className="h-9 w-[148px] shrink-0 cursor-pointer rounded-lg text-xs"
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
      {trailing ? <div className="flex shrink-0 flex-wrap items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
