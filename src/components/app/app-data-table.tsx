import type { ComponentProps, ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AppTableScrollRail } from "./app-table-scroll-rail";
import { TABLE_HEAD_CLASS } from "./constants";

export function AppDataTable({
  columns,
  children,
  empty,
  footer,
  className,
  headerRowClassName,
  stickyHeader = false,
}: {
  columns: { id: string; label: ReactNode; className?: string }[];
  children: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerRowClassName?: string;
  /** Keep the header row visible inside this table's own scroller. */
  stickyHeader?: boolean;
}) {
  return (
    <div
      className={cn(
        stickyHeader
          ? "max-h-[min(640px,62dvh)] overflow-auto [&_[data-slot=table-container]]:overflow-visible"
          : "overflow-x-auto",
        className,
      )}
    >
      {/* QA #18 — mirror the scroller above the header row so a wide list can be
          panned without scrolling to the bottom of the page first. */}
      <AppTableScrollRail />
      <Table>
        <TableHeader className={stickyHeader ? "sticky top-0 z-20 bg-card shadow-sm" : undefined}>
          <TableRow
            className={cn(
              "bg-muted/30 hover:bg-muted/30",
              stickyHeader && "bg-card hover:bg-card",
              headerRowClassName,
            )}
          >
            {columns.map((col) => (
              <TableHead
                key={col.id}
                className={cn(TABLE_HEAD_CLASS, stickyHeader && "bg-card", col.className)}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
      {empty}
      {footer}
    </div>
  );
}

export function AppDataTableEmpty({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-t border-border px-4 py-12 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AppDataTableRow({
  children,
  onClick,
  className,
  ...props
}: ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      className={cn(
        onClick && "cursor-pointer hover:bg-muted/40",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </TableRow>
  );
}

export { TableCell };
