"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useRecentSelections } from "@/lib/use-recent-selections";

export type SearchSelectItem = {
  value: string;
  label: string;
  hint?: string;
  keywords?: string[];
};

export function SearchSelect({
  items,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found",
  defaultLimit = 8,
  recentsKey,
  recentsCount = 5,
  clearable = true,
  disabled,
  className,
}: {
  items: SearchSelectItem[];
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  defaultLimit?: number;
  recentsKey?: string;
  recentsCount?: number;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { recents, push } = useRecentSelections(recentsKey ?? "global");

  const selectedItem = useMemo(
    () => items.find((item) => item.value === value) ?? null,
    [items, value],
  );

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      if (item.label.toLowerCase().includes(term)) return true;
      if (item.hint?.toLowerCase().includes(term)) return true;
      return (item.keywords ?? []).some((keyword) =>
        keyword.toLowerCase().includes(term),
      );
    });
  }, [items, query]);

  const visibleItems = useMemo(() => {
    if (query.trim()) return filteredItems;
    const byId = new Map(items.map((item) => [item.value, item]));
    const recentItems = recents
      .map((id) => byId.get(id))
      .filter((item): item is SearchSelectItem => Boolean(item))
      .slice(0, recentsCount);
    const recentIds = new Set(recentItems.map((item) => item.value));
    const remaining = items
      .filter((item) => !recentIds.has(item.value))
      .slice(0, Math.max(defaultLimit - recentItems.length, 0));
    return [...recentItems, ...remaining];
  }, [query, filteredItems, items, recents, recentsCount, defaultLimit]);

  const showRecentsLabel = !query.trim() && recentsKey && recents.length > 0;
  const hasMore = !query.trim() && visibleItems.length < items.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-input bg-background px-3 text-sm shadow-xs transition-colors",
          selectedItem ? "text-foreground" : "text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className="truncate text-left">
          {selectedItem?.label ?? placeholder}
        </span>
        <span className="ml-2 flex items-center gap-1">
          {clearable && selectedItem ? (
            <span
              role="button"
              tabIndex={0}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChange(null);
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] min-w-[280px] p-2" align="start">
        <div className="mb-2 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 rounded-md"
            placeholder={searchPlaceholder}
            autoFocus
          />
        </div>
        {showRecentsLabel ? (
          <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </p>
        ) : null}
        <div className="max-h-[260px] space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const checked = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/70",
                  checked && "bg-muted",
                )}
                onClick={() => {
                  push(item.value);
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
                {checked ? <Check className="mt-0.5 h-4 w-4 text-primary" /> : null}
              </button>
            );
          })}
          {visibleItems.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{emptyText}</p>
          ) : null}
        </div>
        {hasMore ? (
          <p className="mt-2 px-1 text-[11px] text-muted-foreground">
            {items.length - visibleItems.length} more items. Type to search all.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

