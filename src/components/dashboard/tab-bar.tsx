"use client";

import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TabItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
};

export function TabBar({
  items,
  activeId,
  className,
  onSelect,
}: {
  items: TabItem[];
  activeId: string;
  className?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className={cn("flex flex-wrap gap-6 border-b border-border", className)}>
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            id={`tab-${item.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${item.id}`}
            className={cn(
              "h-auto cursor-pointer rounded-none border-b-2 px-0 pb-3 text-sm font-semibold hover:bg-transparent",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onSelect?.(item.id)}
          >
            {item.icon ? <item.icon className="h-3.5 w-3.5 shrink-0" /> : null}
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
