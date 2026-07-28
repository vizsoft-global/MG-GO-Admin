"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiComboboxItem = {
  value: string;
  label: string;
};

type MultiComboboxProps = {
  items: MultiComboboxItem[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  selectAllLabel?: string;
  clearLabel?: string;
  selectedSummary?: (count: number) => string;
  disabled?: boolean;
  className?: string;
};

export function MultiCombobox({
  items,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results",
  selectAllLabel = "Select all",
  clearLabel = "Clear",
  selectedSummary,
  disabled,
  className,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const itemMap = useMemo(
    () => new Map(items.map((i) => [i.value, i.label])),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selectAllFiltered = () => {
    const ids = filtered.map((i) => i.value);
    const merged = new Set([...value, ...ids]);
    onChange([...merged]);
  };

  const clearAll = () => onChange([]);

  const triggerLabel =
    value.length === 0
      ? placeholder
      : selectedSummary
        ? selectedSummary(value.length)
        : `${value.length} selected`;

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-auto min-h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "truncate text-left",
              value.length === 0 && "text-muted-foreground",
            )}
          >
            {triggerLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--anchor-width)] min-w-[280px] p-0"
          align="start"
        >
          <div className="border-b border-border p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 rounded-md"
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer px-2 text-xs"
                onClick={selectAllFiltered}
                disabled={filtered.length === 0}
              >
                {selectAllLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer px-2 text-xs"
                onClick={clearAll}
                disabled={value.length === 0}
              >
                {clearLabel}
              </Button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {emptyText}
              </p>
            ) : (
              filtered.map((item) => {
                const checked = value.includes(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                      checked && "bg-muted/60",
                    )}
                    onClick={() => toggle(item.value)}
                  >
                    <Checkbox checked={checked} tabIndex={-1} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {checked ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs"
            >
              <span className="truncate">{itemMap.get(id) ?? id}</span>
              {!disabled ? (
                <button
                  type="button"
                  className="cursor-pointer rounded-sm p-0.5 hover:bg-muted"
                  onClick={() => toggle(id)}
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
