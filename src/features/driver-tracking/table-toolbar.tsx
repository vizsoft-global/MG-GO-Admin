"use client";

import type { ReactNode } from "react";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  filterSlot,
  dateSlot,
  onRefresh,
  isRefreshing,
  onExport,
  exportDisabled,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  sortValue: string;
  onSortChange: (v: string) => void;
  sortItems: { value: string; label: string }[];
  filterSlot?: ReactNode;
  dateSlot?: ReactNode;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onExport: () => void;
  exportDisabled?: boolean;
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
      <Select value={sortValue} onValueChange={(v) => v && onSortChange(v)}>
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
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
