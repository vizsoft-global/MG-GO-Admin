"use client";

import type { ReactNode } from "react";
import { LayoutGrid, List, Plus, Search, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ColumnsPopover } from "./columns-popover";
import { FilterChips, type TableFilterChip } from "./filter-chips";
import { resolveToolbarControls } from "./resolve-controls";
import type { TableRowKind, TableToolbarColumn, TableViewMode } from "./toolbar-config";
import type { useTablePrefs } from "./use-table-prefs";

const controlClass =
  "h-9 rounded-lg border border-[var(--border-default)] bg-card text-sm text-foreground shadow-none placeholder:text-[var(--text-muted)]";

export function TableToolbar({
  prefs,
  entity,
  columns,
  rowKind,
  fixedRows,
  entityList,
  filteredCount,
  totalCount,
  onExport,
  onAdd,
  addLabel,
  chips,
  onRemoveChip,
  onClearChips,
}: {
  prefs: ReturnType<typeof useTablePrefs>;
  entity: string;
  columns: TableToolbarColumn[];
  rowKind: TableRowKind;
  fixedRows?: number;
  entityList?: boolean;
  filteredCount: number;
  totalCount: number;
  onExport?: () => void;
  onAdd?: () => void;
  addLabel?: string;
  chips?: TableFilterChip[];
  onRemoveChip?: (id: string) => void;
  onClearChips?: () => void;
}) {
  const t = useTranslations("common.tableToolbar");
  const controls = resolveToolbarControls({
    tableId: "inline",
    entity,
    columns,
    rowKind,
    fixedRows,
    entityList,
    exportAction: onExport,
    addAction: onAdd,
  });
  if (!controls) return null;

  const groups = columns.filter((column) => column.categorical);
  const selectedView: TableViewMode = prefs.view;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 p-4 max-[1023px]:[&>div:first-child]:basis-full">
        {controls.search ? (
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={prefs.query}
              onChange={(event) => prefs.setQuery(event.target.value)}
              placeholder={t("searchEntity", { entity })}
              aria-label={t("searchEntity", { entity })}
              className={cn(controlClass, "ps-8 pe-8")}
            />
            {prefs.query ? (
              <button
                type="button"
                onClick={() => prefs.setQuery("")}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-[var(--text-muted)]"
                aria-label={t("clearSearch")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {controls.groupBy ? (
          <Select
            items={[
              { value: "none", label: t("groupNone") },
              ...groups.map((column) => ({ value: column.id, label: column.label })),
            ]}
            value={prefs.groupBy || "none"}
            onValueChange={(value) => {
              if (value) prefs.setGroupBy(value);
            }}
          >
            <SelectTrigger className={cn(controlClass, "w-auto min-w-[9rem] shrink-0")} aria-label={t("groupBy")}>
              <SelectValue placeholder={t("groupBy")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{`${t("groupBy")}: ${t("groupNone")}`}</SelectItem>
              {groups.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {`${t("groupBy")}: ${column.label}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {controls.grid ? (
          <div className="inline-flex shrink-0 rounded-lg border border-[var(--border-default)] p-0.5">
            <ViewButton
              active={selectedView === "list"}
              label={t("list")}
              onClick={() => prefs.setView("list")}
            >
              <List className="h-4 w-4" />
            </ViewButton>
            <ViewButton
              active={selectedView === "grid"}
              label={t("grid")}
              onClick={() => prefs.setView("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </ViewButton>
          </div>
        ) : null}

        {controls.search ? (
          <p className="shrink-0 text-sm tabular-nums text-[var(--text-muted)]">
            {t("showing", { filtered: filteredCount, total: totalCount })}
          </p>
        ) : null}

        <div className="ms-auto flex shrink-0 items-center gap-2">
          {controls.columns ? (
            <ColumnsPopover
              columns={prefs.orderedColumns}
              isVisible={prefs.isVisible}
              onToggle={prefs.toggleColumn}
              onReset={prefs.resetColumns}
              onReorder={prefs.reorderColumn}
              visibleCount={prefs.visibleCount}
            />
          ) : null}
          {controls.export && onExport ? (
            <Button type="button" variant="outline" className={controlClass} onClick={onExport}>
              <Upload className="h-4 w-4" />
              {t("export")}
            </Button>
          ) : null}
          {controls.add && onAdd ? (
            <Button type="button" className="h-9 rounded-lg" onClick={onAdd}>
              <Plus className="h-4 w-4" />
              {addLabel ?? t("add")}
            </Button>
          ) : null}
        </div>
      </div>
      {chips && onRemoveChip && onClearChips ? (
        <FilterChips chips={chips} onRemove={onRemoveChip} onClearAll={onClearChips} />
      ) : null}
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md",
              active
                ? "bg-[var(--selected-navy)] text-white"
                : "bg-transparent text-[var(--text-muted)]",
            )}
          >
            {children}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
