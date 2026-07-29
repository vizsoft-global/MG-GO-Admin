"use client";

import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TableColumnVisibilityOption } from "@/hooks/use-table-column-visibility";

export function AppTableColumnPicker({
  options,
  isVisible,
  onToggle,
  onReset,
  onMove,
  sourceLabel,
  hiddenCount = 0,
  className,
}: {
  options: TableColumnVisibilityOption[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
  onMove?: (id: string, dir: -1 | 1) => void;
  sourceLabel?: string;
  hiddenCount?: number;
  className?: string;
}) {
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent sm:px-3",
                className,
              )}
              aria-label={t("columnsTooltip")}
            >
              <Columns3 className="h-4 w-4" />
              <span className="hidden sm:inline">{t("columns")}</span>
              {hiddenCount > 0 ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {hiddenCount}
                </span>
              ) : null}
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>{t("columnsTooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("columns")}
            {sourceLabel ? (
              <span className="ms-1 font-normal text-muted-foreground">
                · {sourceLabel}
              </span>
            ) : null}
          </DropdownMenuLabel>
          {options.map((option) => (
            <div key={option.id} className="flex items-center gap-0.5 pe-1">
              <DropdownMenuCheckboxItem
                checked={isVisible(option.id)}
                onCheckedChange={() => onToggle(option.id)}
                className="min-w-0 flex-1 cursor-pointer"
              >
                {option.label}
              </DropdownMenuCheckboxItem>
              {onMove ? (
                <div className="flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMove(option.id, -1);
                    }}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMove(option.id, 1);
                    }}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={onReset}>
          {t("resetColumns")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
