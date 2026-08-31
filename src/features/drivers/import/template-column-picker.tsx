"use client";

import { Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DriverImportColumnSpec } from "./template";

export function TemplateColumnPicker({
  columns,
  selected,
  onToggle,
  onSelectAll,
  onRequiredOnly,
}: {
  columns: readonly DriverImportColumnSpec[];
  /** Optional columns the operator has ticked. Required ones are implicit. */
  selected: ReadonlySet<string>;
  onToggle: (field: string) => void;
  onSelectAll: () => void;
  onRequiredOnly: () => void;
}) {
  const t = useTranslations("pages.drivers.import");
  const included = columns.filter(
    (column) => column.pinned || selected.has(column.field),
  ).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium hover:bg-accent">
        <Columns3 className="h-4 w-4" />
        {t("templateColumns")}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {included}/{columns.length}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("templateColumnsTitle")}</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.field}
              // Identity and the zone/restaurant pair cannot be dropped.
              checked={column.pinned || selected.has(column.field)}
              disabled={column.pinned}
              onCheckedChange={() => onToggle(column.field)}
              className="cursor-pointer"
            >
              {column.header}
              {column.required ? (
                <span className="ms-1 text-destructive" aria-hidden>
                  *
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={onSelectAll}>
          {t("templateSelectAll")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={onRequiredOnly}>
          {t("templateRequiredOnly")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
