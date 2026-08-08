"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(totalCount, (page + 1) * pageSize);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        {t("paginationSummary", { from, to, total: totalCount })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("prevPage")}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t("pageOf", { page: page + 1, totalPages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
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
