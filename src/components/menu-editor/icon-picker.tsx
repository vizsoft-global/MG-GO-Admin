"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ICON_MAP, ICON_NAMES } from "@/lib/menu/menu-registry";
import { LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

export function IconPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (icon: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const Icon = ICON_MAP[value] ?? LayoutDashboard;
  const filtered = ICON_NAMES.filter((n) =>
    n.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "flex items-center justify-center rounded-md border border-border transition-colors hover:bg-muted",
          compact ? "size-7" : "size-8",
        )}
        aria-label="Pick icon"
      >
        <Icon className={compact ? "size-3.5" : "size-4"} />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          placeholder="Search icons..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2 h-8"
        />
        <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
          {filtered.map((name) => {
            const I = ICON_MAP[name];
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted",
                  value === name && "bg-primary/10 ring-1 ring-primary",
                )}
                title={name}
              >
                <I className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
