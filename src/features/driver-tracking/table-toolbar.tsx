"use client";

import type { ReactNode } from "react";
import { ArrowUpDown, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TrackingTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  sortValue,
  onSortChange,
  sortItems,
  sortVariant = "select",
  sortLabel = "Sort by",
  filterSlot,
  dateSlot,
  resultSummary,
  onRefresh,
  isRefreshing,
  refreshLabel = "Refresh",
  onExport,
  exportDisabled,
  exportLabel = "Export",
  showExportLabel = false,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  sortValue: string;
  onSortChange: (v: string) => void;
  sortItems: { value: string; label: string }[];
  sortVariant?: "select" | "menu";
  sortLabel?: string;
  filterSlot?: ReactNode;
  dateSlot?: ReactNode;
  resultSummary?: ReactNode;
  onRefresh: () => void;
  isRefreshing?: boolean;
  refreshLabel?: string;
  onExport: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  showExportLabel?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="ps-9"
        />
      </div>
      {dateSlot}
      {filterSlot}
      {sortVariant === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            aria-label={`${sortLabel}: ${
              sortItems.find((item) => item.value === sortValue)?.label ?? sortLabel
            }`}
            title={sortLabel}
          >
            <ArrowUpDown className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{sortLabel}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortValue}
                onValueChange={(v) => {
                  if (v) onSortChange(v);
                }}
              >
                {sortItems.map((item) => (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    className="cursor-pointer"
                  >
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Select
          value={sortValue}
          onValueChange={(v) => v && onSortChange(v)}
          items={sortItems.map((item) => ({ value: item.value, label: item.label }))}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {resultSummary ? (
          <p className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
            {resultSummary}
          </p>
        ) : null}
        {resultSummary ? (
          <div className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size={showExportLabel ? "sm" : "icon"}
          className={showExportLabel ? "h-9 rounded-lg" : "h-9 w-9 shrink-0 rounded-lg"}
          onClick={onExport}
          disabled={exportDisabled}
          aria-label={exportLabel}
          title={exportLabel}
        >
          <Download className="h-4 w-4" />
          {showExportLabel ? exportLabel : null}
        </Button>
      </div>
    </div>
  );
}
