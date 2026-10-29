"use client";

import type { ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadClass } from "@/features/visits/calendar/colors";
import { ViewSwitch, type CalendarViewMode } from "@/features/visits/calendar/view-switch";
import { cn } from "@/lib/utils";

const LOAD_LEVELS = [1, 2, 3, 4, 5] as const;

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
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--portal-border)] bg-card">
          <CalendarDays className="size-5 text-[var(--accent-rust)]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-[var(--portal-muted)]">
            {apps} › {visitSlots} › {calendar}
          </p>
          <div
            role="heading"
            aria-level={1}
            className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-[var(--portal-ink)]"
          >
            {title}
          </div>
          <p className="text-[13px] leading-5 text-[var(--portal-muted)]">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-6">
        <Button
          type="button"
          variant="portal-secondary"
          className="h-9 rounded-lg border-[var(--portal-border)] bg-card px-4 text-[13px] font-semibold"
          onClick={onExport}
        >
          {exportLabel}
        </Button>
        <span title={comingSoon}>
          <Button
            type="button"
            variant="portal"
            className="h-9 gap-1.5 rounded-lg px-4 text-[13px] font-semibold"
            style={{ opacity: 1 }}
            disabled
          >
            <Plus className="size-4" aria-hidden />
            {newBookingLabel}
          </Button>
        </span>
      </div>
    </header>
  );
}

type CalendarBranchOption = { value: string; label: string };

type CalendarToolbarProps = {
  branchItems: CalendarBranchOption[];
  branchId: string;
  onBranchChange: (value: string | null) => void;
  branchLabel: string;
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
  services: ReactNode;
};

export function CalendarToolbar({
  branchItems,
  branchId,
  onBranchChange,
  branchLabel,
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
  services,
}: CalendarToolbarProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {branchItems.length > 0 ? (
          <Select value={branchId} onValueChange={onBranchChange} items={branchItems}>
            <SelectTrigger
              aria-label={branchLabel}
              className="h-12 w-[190px] gap-2 rounded-[10px] border-[var(--portal-border)] bg-card px-3 py-0 whitespace-normal data-[size=default]:h-12"
            >
              <Building2 className="size-4 text-[var(--portal-muted)]" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="text-[10px] leading-3 text-[var(--portal-muted)]">{branchLabel}</span>
                <SelectValue className="truncate text-[13px] font-semibold text-[var(--portal-ink)]" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {branchItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="flex h-9 items-center rounded-lg border border-[var(--portal-border)] bg-card">
          <button
            type="button"
            aria-label={previousLabel}
            onClick={onPrevious}
            className="flex h-9 w-8 items-center justify-center rounded-s-lg text-[var(--portal-muted)] hover:bg-[var(--visit-tint)]"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="flex items-center gap-1.5 px-1 text-[13px] font-semibold whitespace-nowrap text-[var(--portal-ink)]">
            <CalendarDays className="size-4 text-[var(--portal-muted)]" aria-hidden />
            {label}
          </span>
          <button
            type="button"
            aria-label={nextLabel}
            onClick={onNext}
            className="flex h-9 w-8 items-center justify-center rounded-e-lg text-[var(--portal-muted)] hover:bg-[var(--visit-tint)]"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={onToday}
          className="h-9 rounded-lg border border-[var(--portal-border)] bg-card px-3.5 text-[13px] font-semibold text-[var(--accent-rust)] hover:bg-[var(--visit-tint)]"
        >
          {todayLabel}
        </button>

        <div className="ms-auto flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--portal-muted)]"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              disabled={searchDisabled}
              title={searchDisabled ? searchDisabledHint : undefined}
              aria-describedby={searchDisabled ? "calendar-search-disabled" : undefined}
              className="h-9 w-[240px] rounded-lg border border-[var(--portal-border)] bg-card ps-9 pe-3 text-[13px] text-[var(--portal-ink)] placeholder:text-[var(--portal-muted)] disabled:cursor-not-allowed disabled:text-[var(--portal-muted)]"
            />
          </div>
          <ViewSwitch mode={mode} onChange={onModeChange} labels={viewLabels} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-[var(--visit-line)] px-4 py-2.5">
        {services}
      </div>
    </section>
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
  allCount?: number;
  servicesLabel: string;
  items: ServiceChipItem[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
};

export function ServiceChips({
  allLabel,
  allCount,
  servicesLabel,
  items,
  selectedKey,
  onSelect,
}: ServiceChipsProps) {
  const allSelected = selectedKey == null;
  return (
    <>
      <span className="me-1 text-[13px] font-semibold text-[var(--portal-ink)]">{servicesLabel}</span>
      <button
        type="button"
        aria-pressed={allSelected}
        onClick={() => onSelect(null)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
          allSelected
            ? "border-transparent bg-[var(--portal-ink)] font-semibold text-white"
            : "border-[var(--portal-border)] bg-card text-[var(--portal-ink)]",
        )}
      >
        {allLabel}
        {allCount != null ? (
          <span
            className={cn(
              "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums",
              allSelected ? "bg-white/20 text-white" : "bg-[var(--visit-tint)] text-[var(--portal-muted)]",
            )}
          >
            {allCount}
          </span>
        ) : null}
      </button>
      {items.map((item) => {
        const selected = selectedKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(item.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
              selected
                ? "border-[var(--portal-ink)] bg-[var(--visit-tint)] font-semibold text-[var(--portal-ink)]"
                : "border-[var(--portal-border)] bg-card text-[var(--portal-ink)]",
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-[2px]", item.colorClass)} aria-hidden />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </>
  );
}

type StatusLegendProps = {
  items: { label: string; className: string }[];
};

export function StatusLegend({ items }: StatusLegendProps) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--portal-muted)]"
        >
          <span className={cn("size-2.5 shrink-0 rounded-[3px]", item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function LoadLegend({
  labels,
  variant,
}: {
  labels: { quiet: string; busy: string; full: string; closed: string };
  variant: "month" | "year";
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--portal-muted)]">
      <li className="inline-flex items-center gap-1">
        {labels.quiet}
        {LOAD_LEVELS.slice(0, variant === "year" ? 4 : 3).map((level) => (
          <span key={level} className={cn("size-3.5 rounded-[2px]", loadClass(level))} aria-hidden />
        ))}
      </li>
      <li className="inline-flex items-center gap-1">
        {labels.busy}
        <span className={cn("size-3.5 rounded-[2px]", loadClass(5))} aria-hidden />
      </li>
      <li className="inline-flex items-center gap-1">
        {labels.full}
        <span
          className="size-3.5 rounded-[2px] border border-[var(--visit-cap-full)] bg-[var(--visit-full-wash)]"
          aria-hidden
        />
      </li>
      <li className="inline-flex items-center gap-1">
        {labels.closed}
        <span
          className="size-3.5 rounded-[2px] border border-[var(--visit-line)] bg-[var(--visit-tint)]"
          aria-hidden
        />
      </li>
    </ul>
  );
}

