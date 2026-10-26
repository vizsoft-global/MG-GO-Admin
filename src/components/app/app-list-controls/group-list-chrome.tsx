"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { pageCount, pageRange } from "./list-page";

export function ListPager({
  page,
  total,
  onStep,
}: {
  page: number;
  total: number;
  onStep: (dir: number) => void;
}) {
  const t = useTranslations("common.listControls");
  const range = pageRange(page, total);
  const last = pageCount(total) - 1;
  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-7 w-7"
        disabled={page <= 0}
        onClick={() => onStep(-1)}
        aria-label={t("pagerPrevious")}
      >
        <ChevronLeft className="size-3.5 rtl:rotate-180" />
      </Button>
      <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
        {range.from}–{range.to} / {total}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-7 w-7"
        disabled={page >= last}
        onClick={() => onStep(1)}
        aria-label={t("pagerNext")}
      >
        <ChevronRight className="size-3.5 rtl:rotate-180" />
      </Button>
    </div>
  );
}

export function FlatListPager({
  pager,
  onStep,
  bare = false,
}: {
  pager: { page: number; total: number } | null;
  onStep: (dir: number) => void;
  bare?: boolean;
}) {
  if (!pager) return null;
  return (
    <div className={bare ? "flex justify-end" : "flex justify-end border-b border-border px-4 py-2"}>
      <ListPager page={pager.page} total={pager.total} onStep={onStep} />
    </div>
  );
}

export function GroupHeaderBar({
  label,
  total,
  open,
  page,
  showPager,
  onToggle,
  onStep,
}: {
  label: string;
  total: number;
  open: boolean;
  page: number;
  showPager: boolean;
  onToggle: () => void;
  onStep: (dir: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-7 min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" />
        )}
        <span className="truncate">{label}</span>
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {total}
        </span>
      </button>
      {showPager ? <ListPager page={page} total={total} onStep={onStep} /> : null}
    </div>
  );
}

export function GroupTableHeaderRow({
  colSpan,
  label,
  total,
  open,
  page,
  showPager,
  onToggle,
  onStep,
}: {
  colSpan: number;
  label: string;
  total: number;
  open: boolean;
  page: number;
  showPager: boolean;
  onToggle: () => void;
  onStep: (dir: number) => void;
}) {
  return (
    <AppDataTableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="bg-muted/40 py-1.5">
        <GroupHeaderBar
          label={label}
          total={total}
          open={open}
          page={page}
          showPager={showPager}
          onToggle={onToggle}
          onStep={onStep}
        />
      </TableCell>
    </AppDataTableRow>
  );
}

export function groupHeaderProps(section: {
  label: string;
  total: number;
  open: boolean;
  page: number;
  showPager: boolean;
}): {
  label: string;
  total: number;
  open: boolean;
  page: number;
  showPager: boolean;
} {
  return {
    label: section.label,
    total: section.total,
    open: section.open,
    page: section.page,
    showPager: section.showPager,
  };
}
