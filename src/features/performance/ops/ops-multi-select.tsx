"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type OpsSelectOption = {
  value: string;
  label: string;
  keywords?: string[];
};

export function OpsMultiSelect({
  label,
  options,
  value,
  onChange,
  allLabel,
  searchPlaceholder,
  emptyLabel,
  disabled,
  icon: Icon,
}: {
  label: string;
  options: OpsSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  searchPlaceholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => {
      const hay = [o.label, o.value, ...(o.keywords ?? [])].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [options, q]);

  const selected = new Set(value);
  const allOn = value.length === 0;

  const triggerText = allOn
    ? allLabel
    : value.length === 1
      ? (options.find((o) => o.value === value[0])?.label ?? value[0])
      : `${value.length}`;

  function toggle(id: string) {
    if (allOn) {
      onChange(options.map((o) => o.value).filter((v) => v !== id));
      return;
    }
    const next = selected.has(id)
      ? value.filter((v) => v !== id)
      : [...value, id];
    if (next.length === 0 || next.length === options.length) {
      onChange([]);
      return;
    }
    onChange(next);
  }

  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1 truncate text-[10px] font-medium text-muted-foreground">
        {Icon ? <Icon className="size-3 shrink-0 opacity-70" /> : null}
        {label}
      </p>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQ("");
        }}
      >
        <PopoverTrigger
          disabled={disabled || options.length === 0}
          className={cn(
            "inline-flex h-9 w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-2.5 text-start text-xs",
            disabled || options.length === 0
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-muted/40",
          )}
        >
          <span className="truncate">{options.length === 0 ? (emptyLabel ?? allLabel) : triggerText}</span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(280px,90vw)] origin-(--transform-origin) p-2"
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 mb-2"
          />
          <label className="mb-1 flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40">
            <Checkbox
              checked={allOn}
              onCheckedChange={() => onChange([])}
            />
            <span className="font-medium">{allLabel}</span>
            {allOn ? <Check className="ms-auto size-3 text-emerald-700" /> : null}
          </label>
          <div className="max-h-52 overflow-y-auto">
            {filtered.map((o) => {
              const on = allOn || selected.has(o.value);
              return (
                <label
                  key={o.value}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-muted/40"
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => toggle(o.value)}
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
