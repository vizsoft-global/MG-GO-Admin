"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadClass } from "@/features/visits/calendar/colors";
import { ViewSwitch, type CalendarViewMode } from "@/features/visits/calendar/view-switch";
import { cn } from "@/lib/utils";

const LOAD_LEVELS = [0, 1, 2, 3, 4, 5] as const;

type CalendarPageHeaderProps = {
  apps: string;
  visitSlots: string;
  calendar: string;
  title: string;
  subtitle: string;
  exportLabel: string;
  onExport: () => void;
  newBookingLabel: string;
  comingSoon: string;
};

export function CalendarPageHeader({
  apps,
  visitSlots,
  calendar,
  title,
  subtitle,
  exportLabel,
  onExport,
  newBookingLabel,
  comingSoon,
}: CalendarPageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-[var(--portal-muted)]">
          {apps} › {visitSlots} › {calendar}
        </p>
        <h1 className="type-h1 text-[var(--portal-ink)]">{title}</h1>
        <p className="text-xs text-[var(--portal-muted)]">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="portal-secondary" className="h-9" onClick={onExport}>
          {exportLabel}
        </Button>
        <span title={comingSoon} className="inline-flex">
          <Button type="button" variant="portal" className="h-9" disabled>
            {newBookingLabel}
          </Button>
        </span>
      </div>
    </header>
  );
}

type CalendarToolbarProps = {
  branch: ReactNode;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  todayLabel: string;
  onToday: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchDisabled: boolean;
  searchDisabledHint: string;
  mode: CalendarViewMode;
  onModeChange: (mode: CalendarViewMode) => void;
  viewLabels: { day: string; week: string; month: string; year: string };
};

export function CalendarToolbar({
  branch,
  label,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  todayLabel,
  onToday,
  search,
  onSearchChange,
  searchPlaceholder,
  searchDisabled,
  searchDisabledHint,
  mode,
  onModeChange,
  viewLabels,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {branch}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="portal-neutral"
          className="size-9 px-0"
          aria-label={previousLabel}
          onClick={onPrevious}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-28 text-center text-sm font-semibold text-[var(--portal-ink)]">{label}</span>
        <Button
          type="button"
          variant="portal-neutral"
          className="size-9 px-0"
          aria-label={nextLabel}
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
        <Button type="button" variant="portal-neutral" className="h-9" onClick={onToday}>
          {todayLabel}
        </Button>
      </div>
      <div className="min-w-48 flex-1">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={searchDisabled}
          title={searchDisabled ? searchDisabledHint : undefined}
          aria-describedby={searchDisabled ? "calendar-search-disabled" : undefined}
          className="h-9"
        />
        {searchDisabled ? (
          <p id="calendar-search-disabled" className="mt-0.5 text-[10px] text-muted-foreground">
            {searchDisabledHint}
          </p>
        ) : null}
      </div>
      <ViewSwitch mode={mode} onChange={onModeChange} labels={viewLabels} />
    </div>
  );
}

export type ServiceChipItem = {
  key: string;
  label: string;
  colorClass: string;
  count?: number;
};

type ServiceChipsProps = {
  allLabel: string;
  items: ServiceChipItem[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
};

function serviceRingShadow(colorClass: string): string {
  const token = /--visit-service-[a-z0-9-]+/.exec(colorClass)?.[0] ?? "--visit-service-other";
  return `inset 0 0 0 1px var(${token})`;
}

export function ServiceChips({ allLabel, items, selectedKey, onSelect }: ServiceChipsProps) {
  const allSelected = selectedKey == null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={allSelected}
        onClick={() => onSelect(null)}
        className={cn(
          "inline-flex h-9 items-center rounded-md border px-2.5 text-xs",
          allSelected
            ? "border-transparent bg-white font-semibold text-[var(--portal-ink)] ring-1 ring-[var(--portal-ink)]"
            : "border-border bg-muted/30 text-muted-foreground",
        )}
      >
        {allLabel}
      </button>
      {items.map((item) => {
        const selected = selectedKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(item.key)}
            style={selected ? { boxShadow: serviceRingShadow(item.colorClass) } : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs",
              selected
                ? "border-transparent bg-white font-semibold text-[var(--portal-ink)]"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", item.colorClass)} aria-hidden />
            <span className="truncate">{item.label}</span>
            {item.count != null ? <span className="tabular-nums">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

type StatusLegendProps = {
  items: { label: string; className: string }[];
};

export function StatusLegend({ items }: StatusLegendProps) {
  return (
    <ul className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 shrink-0 rounded-full", item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function LoadLegend() {
  return (
    <div className="flex items-center gap-1">
      {LOAD_LEVELS.map((level) => (
        <span key={level} className={cn("h-5 w-8 rounded", loadClass(level))} />
      ))}
    </div>
  );
}
