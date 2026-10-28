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
import { TableStage } from "./table-toolbar/table-stage";
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
  toolbar,
}: {
  columns: { id: string; label: ReactNode; className?: string }[];
  children: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerRowClassName?: string;
  /** Keep the header row visible inside this table's own scroller. */
  stickyHeader?: boolean;
  /** Shared toolbar. Sits in the same card and sticks with the header. */
  toolbar?: ReactNode;
}) {
  const sticky = stickyHeader || Boolean(toolbar);
  const table = (
    <>
      <AppTableScrollRail />
      <Table>
        <TableHeader
          className={sticky ? "sticky z-20 bg-card shadow-sm" : undefined}
          style={toolbar ? { top: "var(--table-toolbar-offset, 0px)" } : undefined}
        >
          <TableRow
            className={cn(
              toolbar ? "bg-card hover:bg-card" : "bg-muted/30 hover:bg-muted/30",
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
    </>
  );
  return (
    <div
      className={cn(
        sticky
          ? "max-h-[min(640px,62dvh)] overflow-auto [&_[data-slot=table-container]]:overflow-visible"
          : "overflow-x-auto",
        className,
      )}
    >
      {toolbar ? <TableStage toolbar={toolbar}>{table}</TableStage> : table}
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
