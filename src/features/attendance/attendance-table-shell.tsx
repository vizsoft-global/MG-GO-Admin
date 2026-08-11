"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAttendancePaginationState } from "./attendance-pagination";

/** Same wording at toolbar + footer — record range only. */
export function AttendancePaginationSummary({
  page,
  pageSize,
  totalCount,
  className,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  className?: string;
}) {
  const t = useTranslations("pages.attendance");
  const { from, to } = getAttendancePaginationState(page, pageSize, totalCount);
  return (
    <span className={cn("text-sm tabular-nums text-muted-foreground", className)}>
      {t("paginationSummary", { from, to, total: totalCount })}
    </span>
  );
}

export function AttendancePaginationFooter({
  page,
  pageSize,
  totalCount,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const t = useTranslations("pages.attendance");
  const { totalPages } = getAttendancePaginationState(page, pageSize, totalCount);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <AttendancePaginationSummary
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("prevPage")}
        </Button>
        <span className="min-w-[7rem] text-center text-sm tabular-nums text-muted-foreground">
          {t("pageOf", { page: page + 1, totalPages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("nextPage")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function AttendanceTableShell({
  toolbar,
  kpis,
  children,
  footer,
  empty,
  isEmpty,
}: {
  toolbar: ReactNode;
  kpis?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  isEmpty?: boolean;
}) {
  return (
    <div className="space-y-4">
      {kpis}
      {toolbar}
      {isEmpty ? empty : children}
      {!isEmpty ? footer : null}
    </div>
  );
}
