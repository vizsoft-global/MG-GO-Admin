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
import { TABLE_HEAD_CLASS } from "./constants";

export function AppDataTable({
  columns,
  children,
  empty,
  footer,
  className,
  headerRowClassName,
}: {
  columns: { id: string; label: ReactNode; className?: string }[];
  children: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerRowClassName?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow
            className={cn(
              "bg-muted/30 hover:bg-muted/30",
              headerRowClassName,
            )}
          >
            {columns.map((col) => (
              <TableHead key={col.id} className={cn(TABLE_HEAD_CLASS, col.className)}>
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
